from __future__ import annotations

import io
import os
import tempfile
from typing import Any

import cv2
import numpy as np
import scipy.stats
from PIL import Image

try:
    import exiftool  # type: ignore
except Exception:  # pragma: no cover - optional runtime
    exiftool = None


def _to_png_bytes(image_bgr: np.ndarray) -> bytes:
    success, encoded = cv2.imencode(".png", image_bgr)
    if not success:
        raise ValueError("PNG_ENCODING_FAILED")
    return encoded.tobytes()


def _detect_face_region(image_bgr: np.ndarray) -> tuple[int, int, int, int]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    detections = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=6, minSize=(96, 96))
    if len(detections):
        x, y, w, h = max(detections, key=lambda item: item[2] * item[3])
        return int(x), int(y), int(x + w), int(y + h)

    height, width = gray.shape[:2]
    side = int(min(width, height) * 0.55)
    x1 = (width - side) // 2
    y1 = (height - side) // 2
    return x1, y1, x1 + side, y1 + side


def _ela_analysis(image_bgr: np.ndarray, face_bbox: tuple[int, int, int, int]) -> tuple[float, bytes, float]:
    rgb_image = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb_image)
    buffer = io.BytesIO()
    pil_image.save(buffer, format="JPEG", quality=90)
    recompressed = cv2.cvtColor(np.array(Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")), cv2.COLOR_RGB2BGR)

    ela_diff = cv2.absdiff(image_bgr, recompressed)
    ela_amplified = cv2.convertScaleAbs(ela_diff, alpha=10.0)
    ela_gray = cv2.cvtColor(ela_amplified, cv2.COLOR_BGR2GRAY)
    mean_value = float(ela_gray.mean())
    std_value = float(ela_gray.std() + 1e-6)
    threshold = mean_value + (2.5 * std_value)

    x1, y1, x2, y2 = face_bbox
    face_region = ela_gray[y1:y2, x1:x2]
    anomaly_ratio = float(np.mean(face_region > threshold)) if face_region.size else 0.0
    ela_score = float(np.clip(anomaly_ratio / 0.15, 0.0, 1.0))

    heatmap = cv2.applyColorMap(cv2.normalize(ela_gray, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8), cv2.COLORMAP_JET)
    return ela_score, _to_png_bytes(heatmap), anomaly_ratio


def _fft_analysis(image_bgr: np.ndarray) -> tuple[float, bytes]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    fft = np.fft.fftshift(np.fft.fft2(gray))
    power = np.log1p(np.abs(fft))

    height, width = power.shape
    yy, xx = np.indices(power.shape)
    cy, cx = height / 2.0, width / 2.0
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2) + 1.0
    baseline = power * (radius**2)

    step_y = max(height // 8, 6)
    step_x = max(width // 8, 6)
    sample_mask = np.zeros_like(power, dtype=bool)
    sample_mask[::step_y, ::step_x] = True
    sample_mask[int(cy) - 2 : int(cy) + 3, int(cx) - 2 : int(cx) + 3] = False

    periodic_energy = float(power[sample_mask].mean()) if np.any(sample_mask) else 0.0
    expected_energy = float((baseline / (radius**2)).mean() + 1e-6)
    fft_score = float(np.clip((periodic_energy / expected_energy - 1.0) / 1.5, 0.0, 1.0))

    spectrum = cv2.normalize(power, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    spectrum_map = cv2.applyColorMap(spectrum, cv2.COLORMAP_JET)
    return fft_score, _to_png_bytes(spectrum_map)


def _extract_metadata_with_fallback(image_bytes: bytes, temp_path: str) -> dict[str, Any]:
    if exiftool is not None:
        try:
            with exiftool.ExifToolHelper() as helper:
                metadata = helper.get_metadata(temp_path)
            if metadata:
                return metadata[0]
        except Exception:
            pass

    try:
        image = Image.open(io.BytesIO(image_bytes))
        exif_data = image.getexif()
        return {str(tag): value for tag, value in exif_data.items()}
    except Exception:
        return {}


def _exif_analysis(image_bytes: bytes) -> tuple[list[str], float]:
    flags: list[str] = []
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
        temp_file.write(image_bytes)
        temp_path = temp_file.name

    try:
        metadata = _extract_metadata_with_fallback(image_bytes, temp_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    software = str(
        metadata.get("EXIF:Software")
        or metadata.get("Software")
        or metadata.get("305")
        or ""
    ).lower()
    make_value = str(metadata.get("EXIF:Make") or metadata.get("Make") or metadata.get("271") or "").strip()
    model_value = str(metadata.get("EXIF:Model") or metadata.get("Model") or metadata.get("272") or "").strip()
    datetime_original = metadata.get("EXIF:DateTimeOriginal") or metadata.get("DateTimeOriginal") or metadata.get("36867")

    if not datetime_original:
        flags.append("NO_DATETIME")
    if any(token in software for token in ("stable diffusion", "dall-e", "midjourney", "flux", "sora")):
        flags.append("AI_GENERATOR_SOFTWARE")
    if not make_value or not model_value:
        flags.append("BLANK_MAKE_MODEL")

    return flags, min(len(flags) / 3.0, 1.0)


def _noise_analysis(image_bgr: np.ndarray) -> tuple[float, dict[str, float]]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    residual = gray - blurred

    fft = np.fft.fft2(residual)
    autocorrelation = np.fft.ifft2(np.abs(fft) ** 2).real
    autocorrelation = np.fft.fftshift(autocorrelation)
    autocorrelation /= np.max(np.abs(autocorrelation)) + 1e-6

    center_y, center_x = autocorrelation.shape[0] // 2, autocorrelation.shape[1] // 2
    off_center = autocorrelation.copy()
    off_center[center_y - 3 : center_y + 4, center_x - 3 : center_x + 4] = 0
    structured_peak = float(np.max(np.abs(off_center)))
    kurtosis = float(scipy.stats.kurtosis(residual.flatten(), fisher=False, bias=False))
    skewness = float(scipy.stats.skew(residual.flatten(), bias=False))

    kurtosis_component = np.clip((3.0 - min(kurtosis, 3.0)) / 3.0, 0.0, 1.0)
    skew_component = np.clip(abs(skewness) / 2.0, 0.0, 1.0)
    noise_score = float(np.clip((structured_peak * 0.5) + (kurtosis_component * 0.3) + (skew_component * 0.2), 0.0, 1.0))

    return noise_score, {
        "autocorrelation_peak": structured_peak,
        "kurtosis": kurtosis,
        "skewness": skewness,
    }


def _genai_texture_analysis(image_bgr: np.ndarray) -> float:
    """Detect AI-generated images using multiple orthogonal texture signals.

    Signal 1 — JPEG block artifacts:
        Real webcam photos go through JPEG encoding (browser capture pipeline),
        producing 8x8 block boundary discontinuities.  AI images downloaded as
        PNG have NO block artifacts.  This alone strongly separates the two.

    Signal 2 — Cross-channel noise correlation:
        Real camera sensors share a single Bayer filter, so noise across R/G/B
        channels is correlated.  AI generators sample each channel independently,
        producing uncorrelated noise.

    Signal 3 — Local gradient smoothness:
        AI images have unnaturally smooth color transitions (perfect gradients).
        Real photos have micro-texture even in smooth-looking areas.
    """
    h, w = image_bgr.shape[:2]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    # ── Signal 1: JPEG 8x8 block artifact detector ─────────────────────
    # Measure discontinuity at 8-pixel boundaries vs interior
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    residual = gray - blurred
    boundary_diffs = []
    interior_diffs = []
    for y in range(8, h - 8, 8):
        row_boundary = np.abs(residual[y, :] - residual[y - 1, :]).mean()
        row_interior = np.abs(residual[y + 3, :] - residual[y + 2, :]).mean()
        boundary_diffs.append(row_boundary)
        interior_diffs.append(row_interior)
    for x in range(8, w - 8, 8):
        col_boundary = np.abs(residual[:, x] - residual[:, x - 1]).mean()
        col_interior = np.abs(residual[:, x + 3] - residual[:, x + 2]).mean()
        boundary_diffs.append(col_boundary)
        interior_diffs.append(col_interior)

    mean_boundary = np.mean(boundary_diffs) if boundary_diffs else 0.0
    mean_interior = np.mean(interior_diffs) if interior_diffs else 1.0
    # Real JPEGs: boundary >> interior.  Clean PNGs: boundary ≈ interior
    jpeg_ratio = mean_boundary / (mean_interior + 1e-6)
    # jpeg_ratio > 1.15 = has JPEG artifacts (likely real camera)
    # jpeg_ratio ≈ 1.0  = no JPEG artifacts (likely AI-generated PNG)
    jpeg_signal = float(np.clip(1.0 - (jpeg_ratio - 1.0) / 0.25, 0.0, 1.0))

    # ── Signal 2: Cross-channel noise correlation ──────────────────────
    b, g, r = [ch.astype(np.float32) for ch in cv2.split(image_bgr)]
    b_noise = b - cv2.GaussianBlur(b, (5, 5), 0)
    g_noise = g - cv2.GaussianBlur(g, (5, 5), 0)
    r_noise = r - cv2.GaussianBlur(r, (5, 5), 0)
    # Flatten and compute correlations
    bn, gn, rn = b_noise.flatten(), g_noise.flatten(), r_noise.flatten()
    bg_corr = abs(float(np.corrcoef(bn, gn)[0, 1]))
    br_corr = abs(float(np.corrcoef(bn, rn)[0, 1]))
    gr_corr = abs(float(np.corrcoef(gn, rn)[0, 1]))
    avg_corr = (bg_corr + br_corr + gr_corr) / 3.0
    # Real sensors: avg_corr 0.3 – 0.7 (correlated Bayer noise)
    # AI images:    avg_corr 0.0 – 0.15 (independent channels)
    channel_signal = float(np.clip(1.0 - avg_corr / 0.3, 0.0, 1.0))

    # ── Signal 3: Gradient smoothness ──────────────────────────────────
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad_mag = cv2.magnitude(grad_x, grad_y)
    # Measure how smooth the gradient magnitude itself is
    grad_blurred = cv2.GaussianBlur(grad_mag, (9, 9), 0)
    grad_residual = np.abs(grad_mag - grad_blurred)
    grad_roughness = float(grad_residual.mean())
    # Real photos: grad_roughness 3.0 – 15.0 (micro-texture in gradients)
    # AI images:   grad_roughness 0.5 – 2.5  (perfect smooth gradients)
    gradient_signal = float(np.clip(1.0 - grad_roughness / 5.0, 0.0, 1.0))

    # ── Combine signals ────────────────────────────────────────────────
    score = (
        jpeg_signal * 0.35
        + channel_signal * 0.35
        + gradient_signal * 0.30
    )

    return float(np.clip(score, 0.0, 1.0))


def run_stage2(image_bytes: bytes) -> dict:
    try:
        image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return {"passed": False, "reason": "STAGE2_ERROR: INVALID_IMAGE"}

        face_bbox = _detect_face_region(image)
        ela_score, ela_heatmap_png, ela_ratio = _ela_analysis(image, face_bbox)
        fft_score, fft_spectrum_png = _fft_analysis(image)
        exif_flags, exif_score = _exif_analysis(image_bytes)
        noise_score, noise_stats = _noise_analysis(image)

        genai_texture = _genai_texture_analysis(image)

        combined_score = float((ela_score * 0.35) + (fft_score * 0.25) + (exif_score * 0.20) + (noise_score * 0.20))

        passed = combined_score <= 0.65
        elevated = 0.40 <= combined_score <= 0.65
        result = {
            "passed": passed,
            "elevated": elevated,
            "combined_score": combined_score,
            "ela_heatmap_png_bytes": ela_heatmap_png,
            "fft_spectrum_png_bytes": fft_spectrum_png,
            "exif_flags": exif_flags,
            "noise_score": noise_score,
            "genai_texture_score": genai_texture,
            "face_bbox_proxy": list(face_bbox),
            "sub_scores": {
                "ela": ela_score,
                "ela_face_ratio": ela_ratio,
                "fft": fft_score,
                "exif": exif_score,
                "noise": noise_score,
                "genai_texture": genai_texture,
            },
            "noise_stats": noise_stats,
        }
        if not passed:
            result["reason"] = "FORENSIC_ANOMALY"
        return result
    except Exception as exc:
        return {"passed": False, "reason": f"STAGE2_ERROR: {exc}"}
