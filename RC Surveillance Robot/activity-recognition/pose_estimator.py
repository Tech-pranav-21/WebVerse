"""
Pose Estimation Engine.
Handles image decoding, YOLO pose model inference, structured keypoint extraction,
and visual skeleton overlay generation.
"""

import io
import logging
import time
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import (
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_IOU_THRESHOLD,
    KEYPOINT_CONF_THRESHOLD,
    KEYPOINT_NAMES,
    SKELETON_PAIRS,
)
from model_loader import get_model_manager

logger = logging.getLogger("pose_estimator")


class PoseEstimationError(Exception):
    """Custom exception raised when pose estimation fails."""
    pass


class InvalidImageError(PoseEstimationError):
    """Raised when the input image cannot be decoded or is invalid."""
    pass


class ModelNotLoadedError(PoseEstimationError):
    """Raised when the pose model failed to load, so no request can be served (HTTP 503)."""
    pass


def decode_image_bytes(image_bytes: bytes) -> Image.Image:
    """
    Decodes raw image bytes into a PIL RGB Image.
    Raises InvalidImageError if data is corrupt, empty, or unreadable.
    """
    if not image_bytes or len(image_bytes) < 16:
        raise InvalidImageError("Image data is empty or too small to be a valid image.")

    # Validate image magic headers (JPEG: \xff\xd8, PNG: \x89PNG, WebP: RIFF...WEBP, BMP: BM)
    is_jpeg = image_bytes[:2] == b"\xff\xd8"
    is_png = image_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    is_webp = image_bytes[:4] == b"RIFF" and len(image_bytes) >= 12 and image_bytes[8:12] == b"WEBP"
    is_bmp = image_bytes[:2] == b"BM"

    if not (is_jpeg or is_png or is_webp or is_bmp):
        raise InvalidImageError("Invalid image header: Payload is not a recognized JPEG, PNG, WebP, or BMP image.")

    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()  # Force load image data to catch truncation
    except Exception as err:
        raise InvalidImageError(f"Failed to decode image data: {str(err)}") from err

    # Convert to standard RGB (handles RGBA, Grayscale, etc.)
    if image.mode != "RGB":
        image = image.convert("RGB")

    width, height = image.size
    if width <= 0 or height <= 0:
        raise InvalidImageError(f"Invalid image dimensions: {width}x{height}")

    return image


def estimate_pose(
    image_input: Union[bytes, Image.Image, np.ndarray],
    conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    iou_threshold: float = DEFAULT_IOU_THRESHOLD,
    keypoint_conf_threshold: float = KEYPOINT_CONF_THRESHOLD,
) -> Dict[str, Any]:
    """
    Executes human pose estimation on an input image.

    Args:
        image_input: Raw image bytes, PIL Image, or numpy array.
        conf_threshold: Minimum confidence for person detection bounding box.
        iou_threshold: IoU threshold for NMS.
        keypoint_conf_threshold: Threshold to mark a keypoint as visible.

    Returns:
        Structured dictionary with detected people, keypoints, coordinates, and latency.
    """
    manager = get_model_manager()
    if not manager.loaded or manager.model is None:
        raise ModelNotLoadedError("Pose model is not loaded. Check server startup logs.")

    # 1. Decode and validate image
    t_start = time.perf_counter()
    if isinstance(image_input, bytes):
        pil_image = decode_image_bytes(image_input)
    elif isinstance(image_input, Image.Image):
        pil_image = image_input.convert("RGB") if image_input.mode != "RGB" else image_input
    elif isinstance(image_input, np.ndarray):
        pil_image = Image.fromarray(image_input)
    else:
        raise InvalidImageError(f"Unsupported image input type: {type(image_input)}")

    img_width, img_height = pil_image.size
    t_decode = (time.perf_counter() - t_start) * 1000.0

    # 2. Run inference through YOLO
    t_inf_start = time.perf_counter()
    try:
        results = manager.model.predict(
            source=pil_image,
            conf=conf_threshold,
            iou=iou_threshold,
            device=manager.device,
            verbose=False,
        )
    except Exception as err:
        logger.error("Model prediction error: %s", err, exc_info=True)
        raise PoseEstimationError(f"Model inference failed: {str(err)}") from err

    t_inf = (time.perf_counter() - t_inf_start) * 1000.0

    # 3. Parse structured results
    detected_persons: List[Dict[str, Any]] = []

    if results and len(results) > 0:
        res = results[0]  # First image in batch
        boxes = res.boxes
        keypoints = res.keypoints

        has_boxes = boxes is not None and len(boxes) > 0
        has_kpts = keypoints is not None and len(keypoints) > 0

        if has_boxes:
            for idx in range(len(boxes)):
                box = boxes[idx]
                # Bounding box xyxy format
                xyxy = box.xyxy[0].tolist()
                bbox_conf = float(box.conf[0].item()) if box.conf is not None else 0.0
                cls_id = int(box.cls[0].item()) if box.cls is not None else 0

                # YOLO COCO class 0 is "person"
                if cls_id != 0:
                    continue

                x1, y1, x2, y2 = xyxy

                # Extract keypoints for this person
                kpt_list: List[Dict[str, Any]] = []
                visible_count = 0

                if has_kpts and idx < len(keypoints):
                    person_kpts = keypoints[idx]
                    # xy coordinates shape: [17, 2]
                    kpt_xy = person_kpts.xy[0].tolist() if person_kpts.xy is not None else []
                    # confidence shape: [17]
                    kpt_conf = (
                        person_kpts.conf[0].tolist()
                        if person_kpts.conf is not None
                        else [0.0] * len(kpt_xy)
                    )

                    for k_idx in range(len(kpt_xy)):
                        kx, ky = kpt_xy[k_idx]
                        k_name = KEYPOINT_NAMES[k_idx] if k_idx < len(KEYPOINT_NAMES) else f"point_{k_idx}"
                        k_c = float(kpt_conf[k_idx]) if k_idx < len(kpt_conf) else 0.0
                        is_visible = k_c >= keypoint_conf_threshold and (kx > 0 or ky > 0)

                        if is_visible:
                            visible_count += 1

                        kpt_list.append({
                            "id": k_idx,
                            "name": k_name,
                            "x": round(float(kx), 1),
                            "y": round(float(ky), 1),
                            "confidence": round(k_c, 3),
                            "visible": is_visible,
                        })

                detected_persons.append({
                    "person_id": idx,
                    "bbox": {
                        "x1": round(float(x1), 1),
                        "y1": round(float(y1), 1),
                        "x2": round(float(x2), 1),
                        "y2": round(float(y2), 1),
                        "width": round(float(x2 - x1), 1),
                        "height": round(float(y2 - y1), 1),
                    },
                    "bbox_confidence": round(bbox_conf, 3),
                    "keypoints": kpt_list,
                    "visible_keypoints": visible_count,
                    "total_keypoints": len(kpt_list),
                })

    total_time = (time.perf_counter() - t_start) * 1000.0

    return {
        "ok": True,
        "person_count": len(detected_persons),
        "persons": detected_persons,
        "image_width": img_width,
        "image_height": img_height,
        "inference_time_ms": round(t_inf, 2),
        "total_time_ms": round(total_time, 2),
        "device": manager.device,
        "model": manager.model_name,
    }


def draw_pose_overlay(
    pil_image: Image.Image,
    pose_result: Dict[str, Any],
) -> Image.Image:
    """
    Renders visual bounding boxes, skeleton bones, and keypoint dots onto a copy of the image.
    Uses PIL ImageDraw for cross-platform zero-dependency rendering.
    """
    annotated = pil_image.copy()
    draw = ImageDraw.Draw(annotated)

    persons = pose_result.get("persons", [])

    for person in persons:
        bbox = person.get("bbox", {})
        x1, y1, x2, y2 = bbox.get("x1", 0), bbox.get("y1", 0), bbox.get("x2", 0), bbox.get("y2", 0)
        conf = person.get("bbox_confidence", 0.0)
        pid = person.get("person_id", 0)

        # 1. Draw Bounding Box (Cyan)
        draw.rectangle([x1, y1, x2, y2], outline=(0, 220, 255), width=2)

        # Draw label banner. When activity recognition ran, show the stable tracking id and the activity.
        label = f"Person #{pid} ({int(conf * 100)}%)"
        activity = person.get("activity") or {}
        if activity.get("label"):
            act_conf = activity.get("confidence")
            label = f"#{person.get('track_id') or pid} {activity['label']}"
            if act_conf is not None:
                label += f" {int(act_conf * 100)}%"
        draw.rectangle([x1, max(0, y1 - 18), x1 + len(label) * 7 + 10, y1], fill=(0, 220, 255))
        draw.text((x1 + 4, max(0, y1 - 16)), label, fill=(0, 0, 0))

        # Keypoints dict for fast lookup: id -> keypoint
        kpts_by_id = {k["id"]: k for k in person.get("keypoints", [])}

        # 2. Draw Skeleton Bones
        bone_color = (0, 255, 128)  # Spring green
        for p1_id, p2_id in SKELETON_PAIRS:
            kp1 = kpts_by_id.get(p1_id)
            kp2 = kpts_by_id.get(p2_id)
            if kp1 and kp2 and kp1.get("visible") and kp2.get("visible"):
                pt1 = (kp1["x"], kp1["y"])
                pt2 = (kp2["x"], kp2["y"])
                draw.line([pt1, pt2], fill=bone_color, width=2)

        # 3. Draw Keypoint Dots
        for kp in person.get("keypoints", []):
            if kp.get("visible"):
                kx, ky = kp["x"], kp["y"]
                r = 4
                # Outer circle
                draw.ellipse([kx - r, ky - r, kx + r, ky + r], fill=(255, 80, 0), outline=(255, 255, 255), width=1)

    return annotated


def annotate_image_bytes(image_bytes: bytes, pose_result: Dict[str, Any]) -> bytes:
    """
    Renders the pose overlay and encodes back to JPEG bytes.
    """
    pil_image = decode_image_bytes(image_bytes)
    annotated = draw_pose_overlay(pil_image, pose_result)
    output = io.BytesIO()
    annotated.save(output, format="JPEG", quality=90)
    return output.getvalue()
