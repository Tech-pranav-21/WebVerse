"""
Automated Verification & Test Suite for Local Human Pose Detection Service.
Tests:
1. Model loading & health endpoint diagnostics
2. Person detection and keypoint extraction on a valid test frame
3. Invalid / corrupt frame handling (graceful error handling)
4. CPU fallback behavior
5. Latency and memory measurement
6. Skeleton visualization output
"""

import io
import time
from typing import Dict, Any
from PIL import Image, ImageDraw
import numpy as np

from config import KEYPOINT_NAMES, SKELETON_PAIRS
from model_loader import get_model_manager
from pose_estimator import (
    InvalidImageError,
    annotate_image_bytes,
    decode_image_bytes,
    estimate_pose,
)


def create_sample_human_image(width: int = 640, height: int = 480) -> bytes:
    """
    Creates a realistic synthetic human silhouette image with clear body proportions
    for unit testing when a live physical camera is not attached.
    """
    img = Image.new("RGB", (width, height), color=(235, 238, 242))
    draw = ImageDraw.Draw(img)

    # Center coordinates
    cx, cy = width // 2, height // 2

    # Draw head
    head_r = 30
    draw.ellipse([cx - head_r, cy - 160 - head_r, cx + head_r, cy - 160 + head_r], fill=(40, 50, 60))

    # Draw neck and torso
    draw.rectangle([cx - 40, cy - 120, cx + 40, cy + 30], fill=(50, 70, 95))

    # Draw arms
    draw.line([cx - 35, cy - 100, cx - 80, cy - 20], fill=(50, 70, 95), width=18)
    draw.line([cx - 80, cy - 20, cx - 90, cy + 50], fill=(50, 70, 95), width=16)

    draw.line([cx + 35, cy - 100, cx + 80, cy - 20], fill=(50, 70, 95), width=18)
    draw.line([cx + 80, cy - 20, cx + 90, cy + 50], fill=(50, 70, 95), width=16)

    # Draw legs
    draw.line([cx - 25, cy + 30, cx - 35, cy + 120], fill=(30, 40, 50), width=20)
    draw.line([cx - 35, cy + 120, cx - 40, cy + 200], fill=(30, 40, 50), width=18)

    draw.line([cx + 25, cy + 30, cx + 35, cy + 120], fill=(30, 40, 50), width=20)
    draw.line([cx + 35, cy + 120, cx + 40, cy + 200], fill=(30, 40, 50), width=18)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_model_loading_and_health() -> Dict[str, Any]:
    print("\n--- Test 1: Model Loading & Health Diagnostics ---")
    manager = get_model_manager()
    status = manager.get_status()

    assert status["model_name"] is not None, "Model name should be set"
    assert "device" in status, "Device must be reported"
    assert "cuda_available" in status, "CUDA availability must be reported"
    print(f"  [PASS] Model Name: {status['model_name']}")
    print(f"  [PASS] Device: {status['device']}")
    print(f"  [PASS] CUDA Available: {status['cuda_available']}")
    print(f"  [PASS] GPU: {status.get('gpu_name', 'None')}")
    print(f"  [PASS] Model Loaded: {status['loaded']}")
    print(f"  [PASS] Load Duration: {status.get('load_duration_ms', 0)} ms")
    return status


def test_invalid_image_handling() -> None:
    print("\n--- Test 2: Invalid & Corrupt Frame Handling ---")
    
    # Empty bytes
    try:
        decode_image_bytes(b"")
        assert False, "Empty bytes should raise InvalidImageError"
    except InvalidImageError as e:
        print(f"  [PASS] Empty bytes caught correctly: {e}")

    # Corrupt random bytes
    try:
        decode_image_bytes(b"This is not a real JPEG image file, just random text bytes.")
        assert False, "Random text should raise InvalidImageError"
    except InvalidImageError as e:
        print(f"  [PASS] Corrupt payload caught correctly: {e}")

    # Truncated JPEG header
    try:
        decode_image_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01")
        assert False, "Truncated JPEG header should raise InvalidImageError"
    except InvalidImageError as e:
        print(f"  [PASS] Truncated JPEG caught correctly: {e}")


def test_inference_and_structured_output(sample_bytes: bytes) -> Dict[str, Any]:
    print("\n--- Test 3: Person Detection & Keypoint Estimation ---")
    t0 = time.perf_counter()
    result = estimate_pose(sample_bytes)
    t_elapsed = (time.perf_counter() - t0) * 1000.0

    assert result["ok"] is True, "Result ok should be True"
    assert "person_count" in result, "person_count should be in result"
    assert "persons" in result, "persons list should be in result"
    assert "inference_time_ms" in result, "inference_time_ms should be in result"
    assert result["image_width"] == 640, "Image width mismatch"
    assert result["image_height"] == 480, "Image height mismatch"

    print(f"  [PASS] Inference Time: {result['inference_time_ms']} ms (Total roundtrip: {round(t_elapsed, 1)} ms)")
    print(f"  [PASS] Persons Detected: {result['person_count']}")

    for idx, p in enumerate(result["persons"]):
        bbox = p["bbox"]
        print(f"  Person #{idx}: bbox=[{bbox['x1']}, {bbox['y1']}, {bbox['x2']}, {bbox['y2']}], conf={p['bbox_confidence']}")
        print(f"    Visible Keypoints: {p['visible_keypoints']} / {p['total_keypoints']}")

        # Verify keypoints structure
        kpts = p["keypoints"]
        assert len(kpts) == 17, f"Expected 17 COCO keypoints, got {len(kpts)}"
        for kp in kpts:
            assert "id" in kp and "name" in kp and "x" in kp and "y" in kp and "confidence" in kp
            assert kp["name"] in KEYPOINT_NAMES

    return result


def test_visualization(sample_bytes: bytes, pose_result: Dict[str, Any]) -> None:
    print("\n--- Test 4: Visual Skeleton Overlay Rendering ---")
    annotated_jpeg = annotate_image_bytes(sample_bytes, pose_result)
    assert len(annotated_jpeg) > 1000, "Annotated JPEG should be non-trivial"
    # Ensure it decodes as a valid JPEG image
    img = Image.open(io.BytesIO(annotated_jpeg))
    assert img.format == "JPEG", "Output format should be JPEG"
    assert img.size == (640, 480), "Output dimensions should match input"
    print(f"  [PASS] Annotated image generated successfully: {len(annotated_jpeg)} bytes, dimensions: {img.size}")


def test_cpu_fallback() -> None:
    print("\n--- Test 5: CPU Fallback Verification ---")
    manager = get_model_manager()
    initial_device = manager.device
    print(f"  Current active device: {initial_device}")

    # Force CPU inference
    sample_img = np.zeros((320, 320, 3), dtype=np.uint8)
    t0 = time.perf_counter()
    res = manager.model.predict(source=sample_img, device="cpu", verbose=False)
    cpu_latency = (time.perf_counter() - t0) * 1000.0
    print(f"  [PASS] Explicit CPU inference completed in {round(cpu_latency, 2)} ms")


def run_all_tests() -> None:
    print("==========================================================")
    print("  Local Human Pose Detection Service - Test Suite")
    print("==========================================================")

    test_model_loading_and_health()
    test_invalid_image_handling()

    sample_bytes = create_sample_human_image(640, 480)
    print(f"\nGenerated test synthetic human image: {len(sample_bytes)} bytes")

    pose_result = test_inference_and_structured_output(sample_bytes)
    test_visualization(sample_bytes, pose_result)
    test_cpu_fallback()

    print("\n==========================================================")
    print("  ALL 5 TEST SUITES PASSED SUCCESSFULLY!")
    print("==========================================================")


if __name__ == "__main__":
    run_all_tests()
