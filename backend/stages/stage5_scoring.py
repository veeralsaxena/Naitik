from __future__ import annotations

import numpy as np


def _genai_texture_score(stage_results: dict) -> float:
    """Detect pure GenAI images by measuring unnaturally smooth texture.

    Real camera photos have spatially varying sensor noise — the noise level
    differs across patches (shadows are noisier, highlights are cleaner).
    AI-generated images have unnaturally *uniform* noise because every pixel is
    independently sampled from a learned distribution.

    Returns a score 0.0 (natural) → 1.0 (highly synthetic texture).
    """
    try:
        noise_stats = stage_results.get("stage2", {}).get("noise_stats", {})
        sub_scores = stage_results.get("stage2", {}).get("sub_scores", {})
        exif_flags = stage_results.get("stage2", {}).get("exif_flags", [])

        kurtosis = noise_stats.get("kurtosis", 3.0)
        skewness = abs(noise_stats.get("skewness", 0.0))
        noise_score = sub_scores.get("noise", 0.5)
        ela_score = sub_scores.get("ela", 0.5)
        fft_score = sub_scores.get("fft", 0.5)

        # AI images have kurtosis close to 3.0 (Gaussian-like noise), very low
        # skewness, low ELA (no recompression artifacts), and low noise score
        # (no structured sensor noise).  Real webcam photos have higher ELA
        # (JPEG artifacts from the capture pipeline) and more skewed noise.

        kurtosis_signal = max(0.0, 1.0 - abs(kurtosis - 3.0) / 2.0)  # Peaks at exactly 3.0
        skew_signal = max(0.0, 1.0 - skewness / 1.5)                  # Low skew = suspicious
        smoothness_signal = max(0.0, 1.0 - ela_score / 0.3)           # Very low ELA = suspicious
        noise_uniformity = max(0.0, 1.0 - noise_score / 0.4)          # Low noise = suspicious

        texture_score = (
            kurtosis_signal * 0.25
            + skew_signal * 0.20
            + smoothness_signal * 0.30
            + noise_uniformity * 0.25
        )

        # Only flag as GenAI if metadata is also suspicious (no camera info)
        has_no_camera = "BLANK_MAKE_MODEL" in exif_flags
        has_no_datetime = "NO_DATETIME" in exif_flags
        has_ai_software = "AI_GENERATOR_SOFTWARE" in exif_flags

        if has_ai_software:
            return min(texture_score + 0.4, 1.0)

        if has_no_camera and has_no_datetime and texture_score > 0.55:
            # Image is suspiciously smooth AND has no camera metadata.
            # But we need to differentiate from webcam photos which also lack EXIF.
            # Webcam photos always have higher ELA (browser JPEG encoding) and
            # more skewed noise (sensor pattern). So only flag if texture is VERY high.
            if texture_score > 0.70:
                return texture_score
            else:
                return texture_score * 0.5  # Demote borderline cases

        return texture_score * 0.3  # Has camera metadata = likely real, suppress score

    except Exception:
        return 0.0


def run_stage5(stage_results: dict) -> dict:
    try:
        gend_fake_prob = float(stage_results.get("stage3", {}).get("fake_prob", 0.0))
        forensics_score = float(stage_results.get("stage2", {}).get("combined_score", 0.0))
        arcface_similarity = stage_results.get("stage4", {}).get("similarity")
        arcface_similarity = 1.0 if arcface_similarity is None else float(arcface_similarity)
        exif_anomaly = float(stage_results.get("stage2", {}).get("sub_scores", {}).get("exif", 0.0))

        genai_score = _genai_texture_score(stage_results)

        base_score = (
            (gend_fake_prob * 0.30)
            + (forensics_score * 0.20)
            + (genai_score * 0.25)
            + ((1.0 - arcface_similarity) * 0.15)
            + (exif_anomaly * 0.10)
        )

        # Allow any single strong signal to dominate the final score
        raw_score = max(base_score, gend_fake_prob * 0.90, genai_score * 0.92)

        risk_score = int(round(max(0.0, min(raw_score, 1.0)) * 100))

        # Store genai_score in stage_results so the report can reference it
        stage_results.setdefault("stage5_meta", {})["genai_texture_score"] = genai_score

        if risk_score <= 25:
            return {"passed": True, "risk_score": risk_score, "risk_level": "low", "verdict": "APPROVED"}
        if risk_score <= 60:
            return {"passed": True, "risk_score": risk_score, "risk_level": "medium", "verdict": "FLAGGED"}
        if risk_score <= 85:
            return {"passed": True, "risk_score": risk_score, "risk_level": "high", "verdict": "FLAGGED"}
        return {"passed": True, "risk_score": risk_score, "risk_level": "critical", "verdict": "REJECTED"}
    except Exception as exc:
        return {"passed": False, "reason": f"STAGE5_ERROR: {exc}", "risk_score": 100, "risk_level": "critical", "verdict": "REJECTED"}

