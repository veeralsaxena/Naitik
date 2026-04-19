from __future__ import annotations

import importlib.util
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms

LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global singletons
# ---------------------------------------------------------------------------
_gend_model: Optional[torch.nn.Module] = None
_gend_device: Optional[str] = None
_gend_error: Optional[str] = None
_uniface_models: Optional["UniFaceRuntime"] = None
_uniface_error: Optional[str] = None


# ---------------------------------------------------------------------------
# Feature-extractor adapter (used by the heuristic fallback GenD only)
# ---------------------------------------------------------------------------
class FeatureExtractorAdapter:
    def __init__(self, processor: Optional[Any] = None) -> None:
        self.processor = processor
        self.transform = transforms.Compose(
            [
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=[0.48145466, 0.4578275, 0.40821073],
                    std=[0.26862954, 0.26130258, 0.27577711],
                ),
            ]
        )

    def preprocess(self, image: Image.Image) -> torch.Tensor:
        if self.processor is not None:
            encoded = self.processor(images=image, return_tensors="pt")
            return encoded["pixel_values"][0]
        return self.transform(image.convert("RGB"))


# ---------------------------------------------------------------------------
# Heuristic fallback GenD (texture + FFT based, not the real CLIP model)
# ---------------------------------------------------------------------------
class HeuristicGenD(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.feature_extractor = FeatureExtractorAdapter()

    @classmethod
    def from_pretrained(cls, _: str) -> "HeuristicGenD":
        return cls()

    def forward(self, tensors: torch.Tensor) -> torch.Tensor:
        if tensors.dim() == 3:
            tensors = tensors.unsqueeze(0)

        images = tensors.float()
        grayscale = images.mean(dim=1, keepdim=True)

        laplacian_kernel = torch.tensor(
            [[0.0, 1.0, 0.0], [1.0, -4.0, 1.0], [0.0, 1.0, 0.0]],
            device=images.device,
        ).view(1, 1, 3, 3)
        texture_energy = torch.nn.functional.conv2d(grayscale, laplacian_kernel, padding=1).abs().mean(dim=(1, 2, 3))

        fft_map = torch.fft.fftshift(torch.fft.fft2(grayscale.squeeze(1)), dim=(-2, -1))
        fft_mag = torch.log1p(torch.abs(fft_map))
        height, width = fft_mag.shape[-2:]
        step_y = max(height // 8, 4)
        step_x = max(width // 8, 4)
        grid_energy = fft_mag[:, ::step_y, ::step_x].mean(dim=(1, 2))
        overall_energy = fft_mag.mean(dim=(1, 2)) + 1e-6
        periodic_ratio = grid_energy / overall_energy

        saturation = (images.max(dim=1).values - images.min(dim=1).values).mean(dim=(1, 2))
        smoothness = torch.clamp(1.0 - texture_energy / (texture_energy.max().detach() + 1e-6), 0.0, 1.0)
        fake_score = torch.sigmoid((periodic_ratio * 2.2) + (smoothness * 2.0) + (saturation * 0.4) - 1.55)

        real_logit = (1.0 - fake_score) * 5.0
        fake_logit = fake_score * 5.0
        return torch.stack([fake_logit, real_logit], dim=-1)  # index 0 = fake, index 1 = real (matches real GenD)


# ---------------------------------------------------------------------------
# UniFace runtime — wraps the real uniface components with fallback
# ---------------------------------------------------------------------------
@dataclass
class UniFaceRuntime:
    detector: Any = None
    spoofer: Any = None
    recognizer: Any = None
    backend: str = "fallback"

    def detect_faces(self, image_bgr: np.ndarray) -> list[dict[str, Any]]:
        """Detect faces and return normalised dicts with bbox, landmarks, etc."""
        if self.detector is not None:
            try:
                face_objects = self.detector.detect(image_bgr)
                return self._normalise_face_objects(face_objects)
            except Exception:
                LOGGER.debug("UniFace detector.detect() failed, using fallback", exc_info=True)
        return self._detect_faces_fallback(image_bgr)

    def predict_liveness(self, face_crop: np.ndarray, bbox: list[int] | None = None) -> dict[str, float]:
        """Anti-spoofing check using MiniFASNet. Returns {score, label_idx}."""
        if self.spoofer is not None and bbox is not None:
            try:
                label_idx, score = self.spoofer.predict(face_crop, bbox)
                return {"score": float(score), "label_idx": int(label_idx)}
            except Exception:
                LOGGER.debug("UniFace spoofer.predict() failed, using fallback", exc_info=True)
        score = self._fallback_liveness(face_crop)
        return {"score": score, "label_idx": 1 if score >= 0.7 else 0}

    def embed_face(self, face_crop: np.ndarray, landmarks: np.ndarray | None = None) -> np.ndarray:
        """Generate 512-dim ArcFace embedding for a face crop."""
        if self.recognizer is not None:
            try:
                embedding = self.recognizer.get_embedding(face_crop, landmarks)
                return self._normalise_embedding(np.asarray(embedding, dtype=np.float32).flatten())
            except Exception:
                LOGGER.debug("ArcFace get_embedding() failed, using fallback", exc_info=True)

        # Gradient-based pseudo-embedding fallback
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (32, 16), interpolation=cv2.INTER_AREA).astype(np.float32).flatten()
        grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        gradients = cv2.resize(cv2.magnitude(grad_x, grad_y), (16, 16), interpolation=cv2.INTER_AREA).flatten()
        embedding = np.concatenate([resized, gradients], axis=0)
        return self._normalise_embedding(embedding)

    # -- internal helpers --

    def _normalise_face_objects(self, face_objects: list[Any]) -> list[dict[str, Any]]:
        """Convert uniface Face objects to normalised dicts."""
        normalised: list[dict[str, Any]] = []
        for face_obj in face_objects:
            try:
                bbox = np.asarray(face_obj.bbox_xyxy, dtype=np.float32).flatten().tolist()
                landmarks_raw = getattr(face_obj, "landmarks", None)
                landmarks = np.asarray(landmarks_raw).tolist() if landmarks_raw is not None else self._estimate_landmarks(bbox)
                embedding = getattr(face_obj, "embedding", None)

                normalised.append({
                    "bbox": bbox,
                    "landmarks": landmarks,
                    "liveness": None,  # computed separately via spoofer
                    "embedding": np.asarray(embedding, dtype=np.float32) if embedding is not None else None,
                    "pose": {"yaw": self._estimate_yaw(landmarks, bbox)},
                    "confidence": float(getattr(face_obj, "confidence", 0.99)),
                })
            except Exception:
                LOGGER.debug("Failed to normalise face object", exc_info=True)
        return normalised

    def _detect_faces_fallback(self, image_bgr: np.ndarray) -> list[dict[str, Any]]:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        detections = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=6, minSize=(96, 96))
        faces: list[dict[str, Any]] = []
        for (x, y, w, h) in detections:
            bbox = [int(x), int(y), int(x + w), int(y + h)]
            landmarks = self._estimate_landmarks(bbox)
            faces.append({
                "bbox": bbox,
                "landmarks": landmarks,
                "liveness": None,
                "embedding": None,
                "pose": {"yaw": self._estimate_yaw(landmarks, bbox)},
                "confidence": 0.95,
            })
        return faces

    @staticmethod
    def _normalise_embedding(embedding: np.ndarray) -> np.ndarray:
        embedding = embedding.astype(np.float32)
        norm = np.linalg.norm(embedding) + 1e-8
        return embedding / norm

    @staticmethod
    def _estimate_landmarks(bbox: list[int] | tuple) -> list[list[int]]:
        x1, y1, x2, y2 = [int(v) for v in bbox]
        width = x2 - x1
        height = y2 - y1
        return [
            [int(x1 + width * 0.32), int(y1 + height * 0.38)],
            [int(x1 + width * 0.68), int(y1 + height * 0.38)],
            [int(x1 + width * 0.50), int(y1 + height * 0.57)],
            [int(x1 + width * 0.38), int(y1 + height * 0.76)],
            [int(x1 + width * 0.62), int(y1 + height * 0.76)],
        ]

    @staticmethod
    def _estimate_yaw(landmarks: Any, bbox: list | tuple) -> float:
        if not landmarks or len(landmarks) < 3:
            return 0.0
        left_eye = np.asarray(landmarks[0], dtype=np.float32)
        right_eye = np.asarray(landmarks[1], dtype=np.float32)
        nose = np.asarray(landmarks[2], dtype=np.float32)
        eye_center = (left_eye + right_eye) / 2.0
        eye_span = max(np.linalg.norm(right_eye - left_eye), 1.0)
        offset = (nose[0] - eye_center[0]) / eye_span
        return float(np.clip(offset * 45.0, -45.0, 45.0))

    @staticmethod
    def _fallback_liveness(face_crop: np.ndarray) -> float:
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F).var()
        local_contrast = gray.std()
        illumination = np.mean(gray)
        raw_score = (laplacian / 180.0) * 0.45 + (local_contrast / 64.0) * 0.35 + (1.0 - abs(illumination - 128.0) / 128.0) * 0.20
        return float(np.clip(raw_score, 0.0, 0.99))


# ---------------------------------------------------------------------------
# GenD model loader — real CLIP ViT-L/14 with manual class registration
# ---------------------------------------------------------------------------
def _register_gend_classes():
    """Download and register the custom GenD architecture from HuggingFace."""
    from huggingface_hub import hf_hub_download
    from transformers import AutoConfig, AutoModelForImageClassification

    model_path = hf_hub_download("yermandy/GenD_CLIP_L_14", "modeling_gend.py")
    spec = importlib.util.spec_from_file_location("modeling_gend", model_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    try:
        AutoConfig.register("GenD", mod.GenDConfig)
    except Exception:
        pass  # already registered
    try:
        AutoModelForImageClassification.register(mod.GenDConfig, mod.GenD)
    except Exception:
        pass  # already registered

    return mod


def load_gend_model() -> tuple[torch.nn.Module, str]:
    global _gend_model, _gend_device, _gend_error

    if _gend_model is not None and _gend_device is not None:
        return _gend_model, _gend_device

    _gend_device = "mps" if torch.backends.mps.is_available() else "cpu"

    try:
        mod = _register_gend_classes()
        LOGGER.info("Loading real GenD CLIP ViT-L/14 model from yermandy/GenD_CLIP_L_14 ...")
        model = mod.GenD.from_pretrained("yermandy/GenD_CLIP_L_14")
        _gend_model = model.to(_gend_device)
        _gend_model.eval()
        _gend_error = None
        LOGGER.info("GenD model loaded successfully on %s", _gend_device)
    except Exception as exc:
        LOGGER.warning("Falling back to heuristic GenD runtime: %s", exc)
        heuristic_model = HeuristicGenD().to(_gend_device)
        heuristic_model.eval()
        _gend_model = heuristic_model
        _gend_error = str(exc)
    return _gend_model, _gend_device


# ---------------------------------------------------------------------------
# UniFace model loader — RetinaFace + MiniFASNet + ArcFace
# ---------------------------------------------------------------------------
def load_uniface_models() -> UniFaceRuntime:
    global _uniface_models, _uniface_error

    if _uniface_models is not None:
        return _uniface_models

    detector = None
    spoofer = None
    recognizer = None
    backend = "fallback"

    try:
        import uniface as uniface_lib

        try:
            detector = uniface_lib.create_detector("retinaface")
            LOGGER.info("RetinaFace detector loaded (ONNX / CoreML)")
        except Exception as exc:
            LOGGER.warning("RetinaFace detector failed: %s", exc)

        try:
            spoofer = uniface_lib.create_spoofer()
            LOGGER.info("MiniFASNet anti-spoofing model loaded")
        except Exception as exc:
            LOGGER.warning("MiniFASNet spoofer failed: %s", exc)

        try:
            recognizer = uniface_lib.create_recognizer("arcface")
            LOGGER.info("ArcFace recognizer loaded")
        except Exception as exc:
            LOGGER.warning("ArcFace recognizer failed: %s", exc)

        if detector is not None:
            backend = "uniface:retinaface"
            if spoofer is not None:
                backend += "+minifasnet"
            if recognizer is not None:
                backend += "+arcface"
            _uniface_error = None
        else:
            _uniface_error = "UniFace detector initialisation failed"

    except ImportError:
        _uniface_error = "uniface package not installed"
    except Exception as exc:
        _uniface_error = str(exc)
        LOGGER.warning("UniFace initialisation failed: %s", exc)

    _uniface_models = UniFaceRuntime(
        detector=detector,
        spoofer=spoofer,
        recognizer=recognizer,
        backend=backend,
    )
    return _uniface_models


# ---------------------------------------------------------------------------
# Public accessors
# ---------------------------------------------------------------------------
def get_status() -> dict[str, Any]:
    gend_model, device = load_gend_model()
    uniface_models = load_uniface_models()
    return {
        "gend_model_loaded": gend_model is not None,
        "gend_runtime": "heuristic-fallback" if isinstance(gend_model, HeuristicGenD) else "yermandy/GenD_CLIP_L_14",
        "gend_error": _gend_error,
        "uniface_models_loaded": uniface_models is not None,
        "uniface_runtime": uniface_models.backend,
        "uniface_error": _uniface_error,
        "device": device,
    }


def get_gend_model() -> tuple[torch.nn.Module, str]:
    return load_gend_model()


def get_uniface_models() -> UniFaceRuntime:
    return load_uniface_models()
