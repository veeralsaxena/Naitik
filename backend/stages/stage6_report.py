from __future__ import annotations

import base64
from typing import Any, Optional

import cv2


def _encode_png(png_bytes: bytes | None) -> Optional[str]:
    if not png_bytes:
        return None
    return f"data:image/png;base64,{base64.b64encode(png_bytes).decode()}"


def _render_face_bbox(stage_results: dict[str, Any]) -> Optional[str]:
    stage0 = stage_results.get("stage0", {})
    stage1 = stage_results.get("stage1", {})
    frame = stage0.get("preview_frame_array")
    if frame is None:
        return None

    rendered = frame.copy()
    bbox = stage1.get("face_bbox")
    if bbox is not None:
        x1, y1, x2, y2 = [int(value) for value in bbox]
        cv2.rectangle(rendered, (x1, y1), (x2, y2), (0, 214, 255), 3)
        cv2.putText(rendered, "PRIMARY FACE", (x1, max(y1 - 10, 18)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 214, 255), 2)

    success, encoded = cv2.imencode(".png", rendered)
    return _encode_png(encoded.tobytes()) if success else None


def _build_explanation(stage_results: dict[str, Any], reject_reason: Optional[str], risk_result: dict[str, Any]) -> str:
    notes: list[str] = []
    if reject_reason:
        notes.append(f"The verification was rejected because {reject_reason.replace('_', ' ').lower()}.")

    stage2 = stage_results.get("stage2", {})
    stage3 = stage_results.get("stage3", {})
    stage4 = stage_results.get("stage4", {})

    if stage3.get("fake_prob") is not None:
        notes.append(f"GenD estimated a synthetic-face probability of {stage3['fake_prob'] * 100:.1f}%.")
    if stage2.get("combined_score") is not None:
        notes.append(f"Forensic artifact analysis produced a composite anomaly score of {stage2['combined_score'] * 100:.1f}%.")

    genai_score = stage_results.get("stage5_meta", {}).get("genai_texture_score", 0.0)
    if genai_score > 0.50:
        notes.append(f"GenAI Texture Analysis flagged this image with {genai_score * 100:.0f}% synthetic-texture probability — unnaturally uniform noise and missing camera metadata suggest a fully AI-generated image (e.g. Midjourney/Stable Diffusion).")

    if stage2.get("elevated"):
        notes.append("ELA, FFT, EXIF, or noise analysis produced elevated manipulation signals.")
    if stage2.get("exif_flags"):
        notes.append(f"EXIF metadata raised the following flags: {', '.join(stage2['exif_flags']).replace('_', ' ')}.")
    if stage4.get("similarity") is not None:
        notes.append(f"ArcFace similarity between selfie and ID was {stage4['similarity']:.3f}.")
    elif stage4.get("skipped"):
        notes.append("No ID document was supplied, so identity matching was skipped.")

    if not notes:
        verdict = risk_result.get("verdict", "REJECTED").lower()
        return f"The submission completed with a {verdict} outcome and no additional forensic notes."
    return " ".join(notes)


def run_stage6(
    stage_results: dict[str, Any],
    risk_result: dict[str, Any],
    total_time_ms: float,
    session_id: Optional[str] = None,
) -> dict[str, Any]:
    # Only hard-fail reasons should override stage5's verdict.
    # Forensic anomalies and GenD flags are SOFT — stage5 scoring handles them.
    HARD_FAIL_PREFIXES = ("INTAKE_FAIL", "NO_FACE", "MULTIPLE_FACES", "FACE_BBOX_TOO_SMALL",
                          "FACE_POSE_UNSUITABLE", "LIVENESS_FAIL", "VIDEO_NO_FRAMES",
                          "ID_MISMATCH", "ID_NO_FACE", "ID_IMAGE_CORRUPTED",
                          "STAGE0_ERROR", "STAGE1_ERROR", "STAGE2_ERROR", "STAGE4_ERROR")
    reject_reason = None
    for stage_name in ("stage0", "stage1", "stage4"):
        stage_result = stage_results.get(stage_name, {})
        if stage_result and not stage_result.get("passed", True):
            reason = stage_result.get("reason", "UNSPECIFIED_REJECTION")
            if any(reason.startswith(prefix) for prefix in HARD_FAIL_PREFIXES):
                reject_reason = reason
                break

    status = "REJECTED" if reject_reason else risk_result.get("verdict", "REJECTED")
    scores = {
        "blur_variance": stage_results.get("stage0", {}).get("blur_score"),
        "lighting_score": stage_results.get("stage0", {}).get("lighting_score"),
        "liveness": stage_results.get("stage1", {}).get("liveness_score"),
        "face_area_ratio": stage_results.get("stage1", {}).get("face_area_ratio"),
        "pose_yaw": stage_results.get("stage1", {}).get("pose_yaw"),
        "ela_anomaly": stage_results.get("stage2", {}).get("sub_scores", {}).get("ela"),
        "fft_artifact": stage_results.get("stage2", {}).get("sub_scores", {}).get("fft"),
        "noise_score": stage_results.get("stage2", {}).get("noise_score"),
        "exif_flags": stage_results.get("stage2", {}).get("exif_flags", []),
        "exif_anomaly": stage_results.get("stage2", {}).get("sub_scores", {}).get("exif"),
        "gend_fake_prob": stage_results.get("stage3", {}).get("fake_prob"),
        "gend_real_prob": stage_results.get("stage3", {}).get("real_prob"),
        "arcface_similarity": stage_results.get("stage4", {}).get("similarity"),
    }

    signal_breakdown = [
        {
            "name": "Intake Quality",
            "value": round((1.0 - min((scores["blur_variance"] or 0.0) / 500.0, 1.0)) * 100, 1),
            "contributes_to_risk": (scores["blur_variance"] or 0.0) < 140.0 or not 30.0 <= (scores["lighting_score"] or 0.0) <= 230.0,
        },
        {
            "name": "Face Pose",
            "value": round(min(abs(scores["pose_yaw"] or 0.0) / 30.0, 1.0) * 100, 1),
            "contributes_to_risk": abs(scores["pose_yaw"] or 0.0) > 15.0,
        },
        {
            "name": "Liveness",
            "value": round((1.0 - min(scores["liveness"] or 0.0, 1.0)) * 100, 1),
            "contributes_to_risk": (scores["liveness"] or 0.0) < 0.8,
        },
        {
            "name": "ELA",
            "value": round((scores["ela_anomaly"] or 0.0) * 100, 1),
            "contributes_to_risk": (scores["ela_anomaly"] or 0.0) > 0.45,
        },
        {
            "name": "FFT",
            "value": round((scores["fft_artifact"] or 0.0) * 100, 1),
            "contributes_to_risk": (scores["fft_artifact"] or 0.0) > 0.45,
        },
        {
            "name": "GenD",
            "value": round((scores["gend_fake_prob"] or 0.0) * 100, 1),
            "contributes_to_risk": (scores["gend_fake_prob"] or 0.0) > 0.5,
        },
        {
            "name": "GenAI Texture",
            "value": round(stage_results.get("stage5_meta", {}).get("genai_texture_score", 0.0) * 100, 1),
            "contributes_to_risk": stage_results.get("stage5_meta", {}).get("genai_texture_score", 0.0) > 0.50,
        },
        {
            "name": "Identity",
            "value": round((1.0 - (scores["arcface_similarity"] if scores["arcface_similarity"] is not None else 1.0)) * 100, 1),
            "contributes_to_risk": scores["arcface_similarity"] is not None and scores["arcface_similarity"] < 0.5,
        },
    ]

    forensics = {
        "ela_heatmap_b64": _encode_png(stage_results.get("stage2", {}).get("ela_heatmap_png_bytes")),
        "fft_spectrum_b64": _encode_png(stage_results.get("stage2", {}).get("fft_spectrum_png_bytes")),
        "gradcam_overlay_b64": _encode_png(stage_results.get("stage3", {}).get("gradcam_overlay_png_bytes")),
        "face_bbox_b64": _render_face_bbox(stage_results),
        "scores": scores,
    }

    return {
        "session_id": session_id,
        "status": status,
        "risk_score": int(risk_result.get("risk_score", 100)),
        "risk_level": risk_result.get("risk_level", "critical"),
        "processing_time_ms": round(total_time_ms, 2),
        "reject_reason": reject_reason,
        "explanation": _build_explanation(stage_results, reject_reason, risk_result),
        "forensics": forensics,
        "scores": scores,
        "signal_breakdown": signal_breakdown,
        "video_analysis": {
            "frame_scores": stage_results.get("stage3", {}).get("frame_scores"),
            "temporal_variance": stage_results.get("stage3", {}).get("temporal_variance"),
        },
    }
