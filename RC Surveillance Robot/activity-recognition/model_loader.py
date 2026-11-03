"""
Model Loader for Local Human Pose Detection Service.
Loads and caches the YOLO pose model once in memory / VRAM,
with automatic device selection, CPU fallback, and warm-up inference.
"""

import logging
import time
from typing import Any, Dict, Optional
import numpy as np

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    torch = None
    TORCH_AVAILABLE = False

try:
    from ultralytics import YOLO
    ULTRALYTICS_AVAILABLE = True
except ImportError:
    YOLO = None
    ULTRALYTICS_AVAILABLE = False

from config import DEFAULT_MODEL_NAME, FORCE_DEVICE

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(message)s")
logger = logging.getLogger("pose_model_loader")


class ModelManager:
    """Singleton model manager that loads the pose model once and manages device fallback."""

    _instance: Optional["ModelManager"] = None

    def __new__(cls) -> "ModelManager":
        if cls._instance is None:
            cls._instance = super(ModelManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return

        self.model: Any = None
        self.device: str = "cpu"
        self.gpu_name: Optional[str] = None
        self.cuda_available: bool = False
        self.model_name: str = DEFAULT_MODEL_NAME
        self.loaded: bool = False
        self.load_duration_ms: float = 0.0
        self.warmup_duration_ms: float = 0.0

        self._resolve_device()
        self._load_model()
        self._initialized = True

    def _resolve_device(self) -> None:
        """Determines whether to use CUDA GPU or CPU based on hardware and config."""
        if TORCH_AVAILABLE and torch.cuda.is_available():
            self.cuda_available = True
            self.gpu_name = torch.cuda.get_device_name(0)
            logger.info("CUDA GPU detected: %s (Device count: %d)", self.gpu_name, torch.cuda.device_count())
        else:
            self.cuda_available = False
            self.gpu_name = None
            logger.info("CUDA GPU not available or PyTorch CPU-only build active.")

        if FORCE_DEVICE == "cuda":
            if self.cuda_available:
                self.device = "cuda:0"
            else:
                logger.warning("FORCE_DEVICE='cuda' requested, but CUDA is unavailable! Falling back to CPU.")
                self.device = "cpu"
        elif FORCE_DEVICE == "cpu":
            self.device = "cpu"
            logger.info("Explicit CPU device requested by config.")
        else:  # 'auto'
            self.device = "cuda:0" if self.cuda_available else "cpu"

        logger.info("Target execution device selected: %s", self.device)

    def _load_model(self) -> None:
        """Loads the YOLO pose model and performs a warm-up inference run."""
        if not ULTRALYTICS_AVAILABLE:
            logger.error("Ultralytics library is not installed! Model cannot be loaded.")
            self.loaded = False
            return

        start_time = time.perf_counter()
        logger.info("Loading pose estimation model '%s' onto device '%s'...", self.model_name, self.device)

        try:
            # Instantiate model
            self.model = YOLO(self.model_name)
            # Move to target device
            if self.device.startswith("cuda"):
                try:
                    self.model.to(self.device)
                except Exception as cuda_err:
                    logger.warning("Failed to allocate model on CUDA (%s). Falling back to CPU.", cuda_err)
                    self.device = "cpu"
                    self.model.to("cpu")

            self.load_duration_ms = (time.perf_counter() - start_time) * 1000.0
            self.loaded = True
            logger.info("Model loaded successfully in %.2f ms on device '%s'.", self.load_duration_ms, self.device)

            # Warm-up inference
            self._warmup()

        except Exception as err:
            logger.error("Fatal error loading model '%s': %s", self.model_name, err, exc_info=True)
            self.loaded = False
            self.model = None

    def _warmup(self) -> None:
        """Executes a single blank dummy frame to compile computation graphs and avoid cold start."""
        if not self.loaded or self.model is None:
            return

        logger.info("Running warm-up inference...")
        warmup_start = time.perf_counter()
        try:
            # 640x640 dummy black image (H, W, C)
            dummy_frame = np.zeros((640, 640, 3), dtype=np.uint8)
            _ = self.model.predict(
                source=dummy_frame,
                device=self.device,
                verbose=False,
                conf=0.5,
            )
            self.warmup_duration_ms = (time.perf_counter() - warmup_start) * 1000.0
            logger.info("Warm-up inference complete in %.2f ms.", self.warmup_duration_ms)
        except Exception as warmup_err:
            logger.warning("Warm-up inference encountered an issue: %s", warmup_err)

    def get_vram_info(self) -> Dict[str, Optional[float]]:
        """Returns current VRAM usage in megabytes if CUDA is in use."""
        if self.device.startswith("cuda") and TORCH_AVAILABLE and torch.cuda.is_available():
            try:
                allocated = torch.cuda.memory_allocated(0) / (1024 * 1024)
                reserved = torch.cuda.memory_reserved(0) / (1024 * 1024)
                total = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
                return {
                    "vram_allocated_mb": round(allocated, 2),
                    "vram_reserved_mb": round(reserved, 2),
                    "vram_total_mb": round(total, 2),
                }
            except Exception:
                pass
        return {
            "vram_allocated_mb": None,
            "vram_reserved_mb": None,
            "vram_total_mb": None,
        }

    def get_status(self) -> Dict[str, Any]:
        """Provides status summary for health check and diagnostics."""
        vram = self.get_vram_info()
        return {
            "loaded": self.loaded,
            "model_name": self.model_name,
            "device": self.device,
            "cuda_available": self.cuda_available,
            "gpu_name": self.gpu_name,
            "load_duration_ms": round(self.load_duration_ms, 2),
            "warmup_duration_ms": round(self.warmup_duration_ms, 2),
            **vram,
        }


# Global singleton accessor
def get_model_manager() -> ModelManager:
    return ModelManager()
