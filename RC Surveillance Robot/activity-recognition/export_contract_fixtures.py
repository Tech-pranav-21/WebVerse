"""
Records REAL responses of the pose service as JSON fixtures for the dashboard's tests.

  python activity-recognition/export_contract_fixtures.py            write frontend/tests/fixtures/*.json
  python activity-recognition/export_contract_fixtures.py --check    fail if the stored files no longer match
                                                                      what the service produces (schema drift)

Every fixture is the body of an actual ``POST /detect`` answer: the YOLOv8 model runs on a photograph (or
a photo-derived image) and the activity engine runs on its real keypoints. Nothing is typed in by hand.
The frontend tests parse these files with the same code that parses live responses, so the TypeScript
types, the validator and the UI are checked against what the backend really sends.
"""

import argparse
import base64
import json
import os
import sys
from typing import Any, Callable, Dict, List

from fastapi.testclient import TestClient
from PIL import Image

import service
from activity_engine import get_activity_engine
from photo_fixtures import canvas_with_person, jpeg_bytes, load_photo, moving_person_frames

FIXTURE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "tests", "fixtures")
)


class _Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def _b64(img: Image.Image) -> str:
    return base64.b64encode(jpeg_bytes(img)).decode("ascii")


def _post(client: TestClient, img: Image.Image, session: str, **extra: Any) -> Dict[str, Any]:
    r = client.post("/detect", json={"imageBase64": _b64(img), "sessionId": session, **extra})
    r.raise_for_status()
    return r.json()


def build_fixtures() -> Dict[str, Dict[str, Any]]:
    engine = get_activity_engine()
    clock = _Clock()
    real_clock, engine._clock = engine._clock, clock
    engine.reset()
    client = TestClient(service.app)
    photo = load_photo()
    out: Dict[str, Dict[str, Any]] = {}

    def sequence(name: str, frames: List[Image.Image], dt: float, session: str) -> None:
        last: Dict[str, Any] = {}
        for frame in frames:
            last = _post(client, frame, session)
            clock.t += dt
        out[name] = last

    try:
        out["pose-standing-single-frame"] = _post(client, photo, "fx-single")
        sequence("pose-standing-confirmed", [photo] * 5, 1.0, "fx-standing")
        sequence("pose-upper-body", [photo.crop((0, 0, photo.width, 400))] * 5, 1.0, "fx-upper")
        out["pose-partial-legs-cut"] = _post(client, photo.crop((380, 150, 820, 700)), "fx-partial")
        out["pose-insufficient-head-only"] = _post(client, photo.crop((380, 0, 830, 200)), "fx-insufficient")
        sequence("pose-lying-down", [photo.rotate(90, expand=True)] * 5, 1.0, "fx-lying")
        out["pose-no-person"] = _post(client, Image.new("RGB", (640, 480), (90, 90, 90)), "fx-empty")

        # Standing, then walking sideways: real keypoints moving across a canvas.
        still = moving_person_frames(4, 0)
        moving = moving_person_frames(8, 110)
        sequence("pose-walking-confirmed", still + moving, 1.0, "fx-walk")

        # The same real lying keypoints for 70 s: Lying Down -> Prolonged Inactivity -> Possible Sleeping.
        lying = photo.rotate(90, expand=True)
        sequence("pose-possible-sleeping", [lying] * 70, 1.0, "fx-sleep")

        # A person who left the view: the track is reported as lost.
        _post(client, photo, "fx-lost")
        clock.t += 1.0
        out["pose-person-lost"] = _post(client, Image.new("RGB", (640, 480), (90, 90, 90)), "fx-lost")
    finally:
        engine._clock = real_clock
        engine.reset()
    return out


def _strip(body: Dict[str, Any]) -> Dict[str, Any]:
    """Fixtures stay small and stable: no overlay image, and latency/uptime numbers that vary per run."""
    body = json.loads(json.dumps(body))
    body.pop("annotated_image_base64", None)
    if isinstance(body.get("model"), str):          # the service reports an absolute path; keep the file name only
        body["model"] = body["model"].replace("\\", "/").rsplit("/", 1)[-1]
    for key in ("inference_time_ms", "total_time_ms"):
        if key in body:
            body[key] = round(float(body[key]), 1)
    return body


def shape(obj: Any) -> Any:
    """The key structure of a response (values, list lengths and the free-form `evidence` are ignored)."""
    if isinstance(obj, dict):
        return {k: ("<evidence>" if k == "evidence" else shape(v)) for k, v in sorted(obj.items())}
    if isinstance(obj, list):
        return [shape(obj[0])] if obj else []
    return type(obj).__name__ if obj is not None else "null"


def _key_structure(obj: Any) -> Any:
    """`shape` without value types, so a field that is null in one run and a number in another still matches."""
    if isinstance(obj, dict):
        return {k: ("<evidence>" if k == "evidence" else _key_structure(v)) for k, v in sorted(obj.items())}
    if isinstance(obj, list):
        return [_key_structure(obj[0])] if obj else []
    return "value"


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="compare with the stored files instead of writing")
    args = parser.parse_args(argv)

    fixtures = {name: _strip(body) for name, body in build_fixtures().items()}
    if args.check:
        problems = []
        for name, body in fixtures.items():
            path = os.path.join(FIXTURE_DIR, f"{name}.json")
            if not os.path.exists(path):
                problems.append(f"{name}.json is missing")
                continue
            with open(path, encoding="utf-8") as fh:
                stored = json.load(fh)
            if stored.get("persons") and body.get("persons"):
                if _key_structure(stored["persons"][0]) != _key_structure(body["persons"][0]):
                    problems.append(f"{name}.json: the person structure no longer matches the service")
            if sorted(stored) != sorted(body):
                problems.append(f"{name}.json: top-level fields differ ({sorted(set(stored) ^ set(body))})")
        if problems:
            print("Fixtures are out of date. Regenerate with: python activity-recognition/export_contract_fixtures.py")
            print("\n".join(" - " + p for p in problems))
            return 1
        print(f"{len(fixtures)} fixtures match the service.")
        return 0

    os.makedirs(FIXTURE_DIR, exist_ok=True)
    for name, body in fixtures.items():
        with open(os.path.join(FIXTURE_DIR, f"{name}.json"), "w", encoding="utf-8") as fh:
            json.dump(body, fh, indent=2, sort_keys=False)
            fh.write("\n")
        persons = body.get("persons", [])
        label = persons[0]["activity"]["label"] if persons and persons[0].get("activity") else "-"
        print(f"wrote {name}.json  persons={body['person_count']}  activity={label}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
