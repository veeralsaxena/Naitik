from __future__ import annotations

import mimetypes
import os
import tempfile
from typing import Optional

import cv2
import numpy as np

try:
    import magic  # type: ignore
except Exception:  # pragma: no cover - optional runtime path
    magic = None

MAX_FILE_SIZE = 50 * 1024 * 1024
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", *VIDEO_EXTENSIONS}
MIME_MAP = {
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
    ".mp4": {"video/mp4", "application/mp4"},
    ".mov": {"video/quicktime"},
    ".webm": {"video/webm"},
}

# Quality thresholds — relaxed for real-world photos
BLUR_THRESHOLD = 35.0       # Laplacian variance below this = reject
LIGHTING_MIN = 20.0         # LAB L-channel mean
LIGHTING_MAX = 240.0


def _detect_mime(file_bytes: bytes, filename: str) -> str:
    if magic is not None:
        detected = magic.from_buffer(file_bytes, mime=True)
        if detected:
            return str(detected)
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def _frame_metrics(frame_bgr: np.ndarray) -> tuple[float, float]:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
    lighting_score = float(lab[:, :, 0].mean())
    return blur_score, lighting_score


def _read_video_preview(file_bytes: bytes, suffix: str) -> tuple[Optional[np.ndarray], tuple[int, int]]:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
        temp_file.write(file_bytes)
        temp_path = temp_file.name

    try:
        capture = cv2.VideoCapture(temp_path)
        ok, frame = capture.read()
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        capture.release()
        return (frame if ok else None), (width, height)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def run_stage0(file_bytes: bytes, filename: str) -> dict:
    """Intake gate — validates file format, resolution, blur, and lighting.

    Always returns quality metrics (blur_score, lighting_score, preview_frame_array)
    even when the stage fails, so downstream stages can still produce forensic
    visualisations for the analyst dashboard.
    """
    try:
        suffix = os.path.splitext(filename)[1].lower()
        if suffix not in ALLOWED_EXTENSIONS:
            return {"passed": False, "reason": "INTAKE_FAIL: UNSUPPORTED_FILE_TYPE"}

        file_size = len(file_bytes)
        if file_size > MAX_FILE_SIZE:
            return {"passed": False, "reason": "INTAKE_FAIL: FILE_TOO_LARGE"}

        mime_type = _detect_mime(file_bytes, filename)
        valid_mimes = MIME_MAP.get(suffix, set())
        if valid_mimes and mime_type not in valid_mimes:
            return {
                "passed": False,
                "reason": f"INTAKE_FAIL: MIME_MISMATCH ({mime_type} != {','.join(sorted(valid_mimes))})",
            }

        # --- Video path ---
        if suffix in VIDEO_EXTENSIONS:
            preview_frame, (width, height) = _read_video_preview(file_bytes, suffix)
            if preview_frame is None:
                return {"passed": False, "reason": "INTAKE_FAIL: CORRUPTED_VIDEO"}

            blur_score, lighting_score = _frame_metrics(preview_frame)
            warnings: list[str] = []
            passed = True

            if width < 480 or height < 480:
                passed = False
                warnings.append("RESOLUTION_TOO_LOW")
            if blur_score < BLUR_THRESHOLD:
                passed = False
                warnings.append("BLUR_TOO_HIGH")
            if lighting_score < LIGHTING_MIN or lighting_score > LIGHTING_MAX:
                passed = False
                warnings.append("LIGHTING_OUT_OF_RANGE")

            result = {
                "passed": passed,
                "dimensions": [width, height],
                "format": suffix.replace(".", ""),
                "mime_type": mime_type,
                "file_size": file_size,
                "blur_score": blur_score,
                "lighting_score": lighting_score,
                "preview_frame_array": preview_frame,
                "raw_bytes": file_bytes,
            }
            if not passed:
                result["reason"] = f"INTAKE_FAIL: {', '.join(warnings)}"
                result["warnings"] = warnings
            return result

        # --- Image path ---
        image_array = np.frombuffer(file_bytes, np.uint8)
        image_bgr = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image_bgr is None:
            return {"passed": False, "reason": "INTAKE_FAIL: CORRUPTED_IMAGE"}

        height, width = image_bgr.shape[:2]
        blur_score, lighting_score = _frame_metrics(image_bgr)
        warnings = []
        passed = True

        if width < 480 or height < 480:
            passed = False
            warnings.append("RESOLUTION_TOO_LOW")
        if blur_score < BLUR_THRESHOLD:
            passed = False
            warnings.append("BLUR_TOO_HIGH")
        if lighting_score < LIGHTING_MIN or lighting_score > LIGHTING_MAX:
            passed = False
            warnings.append("LIGHTING_OUT_OF_RANGE")

        result = {
            "passed": passed,
            "dimensions": [width, height],
            "format": suffix.replace(".", "") or "image",
            "mime_type": mime_type,
            "file_size": file_size,
            "blur_score": blur_score,
            "lighting_score": lighting_score,
            "preview_frame_array": image_bgr,
            "raw_bytes": file_bytes,
        }
        if not passed:
            result["reason"] = f"INTAKE_FAIL: {', '.join(warnings)}"
            result["warnings"] = warnings
        return result
    except Exception as exc:
        return {"passed": False, "reason": f"INTAKE_FAIL: {exc}"}
