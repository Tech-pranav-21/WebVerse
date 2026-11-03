"""
Photograph-based fixtures for tests that run the REAL YOLOv8 pose model.

The only input is ``test_person.jpg`` (a real, full-body, standing person). Everything else is derived
from it: crops (upper body, legs cut off), rotations (a person lying), a smaller copy pasted on a canvas
(a person far away) and a person pasted at different positions over time (movement).
"""

import io
import os
from typing import List, Tuple

from PIL import Image

PHOTO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_person.jpg")
# Box around the person in the photograph (pixels), with a little margin.
_PERSON_BOX = (440, 20, 765, 880)


def load_photo() -> Image.Image:
    return Image.open(PHOTO_PATH).convert("RGB")


def jpeg_bytes(img: Image.Image, quality: int = 92) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def person_cutout(height: int) -> Image.Image:
    """The person alone, scaled to ``height`` pixels tall (background kept: it is a plain wall and floor)."""
    crop = load_photo().crop(_PERSON_BOX)
    scale = height / crop.height
    return crop.resize((max(1, round(crop.width * scale)), height), Image.LANCZOS)


def canvas_with_person(size: Tuple[int, int], person_height: int, x: int, bottom: int, grey: int = 128) -> Image.Image:
    """A plain canvas with the person standing with their feet at ``bottom`` and their left edge at ``x``."""
    canvas = Image.new("RGB", size, (grey, grey, grey))
    cut = person_cutout(person_height)
    canvas.paste(cut, (x, bottom - cut.height))
    return canvas


def moving_person_frames(
    n: int, px_per_frame: int, person_height: int = 300, size: Tuple[int, int] = (960, 540), x0: int = 30
) -> List[Image.Image]:
    """The same person at ``x0 + i * px_per_frame`` for i in range(n): sideways movement with real keypoints."""
    return [canvas_with_person(size, person_height, x0 + i * px_per_frame, size[1] - 20) for i in range(n)]
