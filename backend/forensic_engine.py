from __future__ import annotations

import asyncio
import os
import tempfile
import time
from typing import Any, Optional

import cv2
import numpy as np

from models import model_loader
from stages import (
    stage0_intake,
    stage1_face,
    stage2_forensics,
    stage3_deepfake,
    stage4_identity,
    stage5_scoring,
    stage6_report,
)

VIDEO_EXTENSIONS = (".mp4", ".mov", ".webm")


def extract_video_frames(video_bytes: bytes, suffix: str, num_frames: int = 10) -> list[np.ndarray]:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
        temp_file.write(video_bytes)
        temp_path = temp_file.name

    frames: list[np.ndarray] = []
    try:
        capture = cv2.VideoCapture(temp_path)
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total_frames <= 0:
            return frames

        frame_indexes = np.linspace(0, max(total_frames - 1, 0), num=min(num_frames, total_frames), dtype=int)
        for frame_index in frame_indexes:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame_index))
            ok, frame = capture.read()
            if ok and frame is not None:
                frames.append(frame)
        capture.release()
        return frames
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


async def run_pipeline(
    media_file: dict[str, Any],
    id_document: Optional[dict[str, Any]] = None,
    session_id: Optional[str] = None,
) -> dict[str, Any]:
    """Run the full 7-stage forensic pipeline.

    Key design: stages are NEVER short-circuited. Even if stage 0 or stage 1
    fails (bad blur, no face detected, liveness fail), the pipeline continues
    to run forensic analysis (stages 2-3) so the analyst dashboard always has
    heatmaps, Grad-CAM overlays, and per-signal scores to display.
    Failures are recorded as flags and fed into the risk scoring.
    """
    started_at = time.perf_counter()
    stage_results: dict[str, Any] = {}
    rejection_reasons: list[str] = []

    try:
        media_bytes = media_file["bytes"]
        filename = media_file["filename"]
        suffix = os.path.splitext(filename)[1].lower() or ".bin"

        # ── Stage 0 — Intake Gate ──────────────────────────────────────
        stage_results["stage0"] = stage0_intake.run_stage0(media_bytes, filename)
        if not stage_results["stage0"].get("passed"):
            rejection_reasons.append(stage_results["stage0"].get("reason", "INTAKE_FAIL"))

        # If the image couldn't be decoded at all, we truly can't continue
        preview = stage_results["stage0"].get("preview_frame_array")
        if preview is None:
            return _build_final_report(stage_results, rejection_reasons, started_at, session_id)

        gend_model, device = model_loader.get_gend_model()
        uniface_models = model_loader.get_uniface_models()
        is_video = suffix in VIDEO_EXTENSIONS

        # ── Stage 1 — Face Gate ────────────────────────────────────────
        face_crop: Optional[np.ndarray] = None
        stage3_input: Any = None

        if is_video:
            frames = await asyncio.to_thread(extract_video_frames, media_bytes, suffix, 10)
            if not frames:
                stage_results["stage1"] = {"passed": False, "reason": "VIDEO_NO_FRAMES"}
                rejection_reasons.append("VIDEO_NO_FRAMES")
            else:
                encoded_frame = cv2.imencode(".jpg", frames[0])[1].tobytes()
                stage_results["stage1"] = await asyncio.to_thread(
                    stage1_face.run_stage1, encoded_frame, uniface_models
                )
                if not stage_results["stage1"].get("passed"):
                    rejection_reasons.append(stage_results["stage1"].get("reason", "FACE_GATE_FAIL"))

                # Even if face gate failed, try to get face crops for forensics
                if stage_results["stage1"].get("face_bbox"):
                    x1, y1, x2, y2 = [int(v) for v in stage_results["stage1"]["face_bbox"]]
                    frame_crops: list[np.ndarray] = []
                    for frame in frames:
                        h, w = frame.shape[:2]
                        crop = frame[max(y1, 0) : min(y2, h), max(x1, 0) : min(x2, w)]
                        if crop.size:
                            frame_crops.append(crop)
                    if frame_crops:
                        stage3_input = frame_crops
                        face_crop = frame_crops[0]
        else:
            stage_results["stage1"] = await asyncio.to_thread(
                stage1_face.run_stage1, media_bytes, uniface_models
            )
            if not stage_results["stage1"].get("passed"):
                rejection_reasons.append(stage_results["stage1"].get("reason", "FACE_GATE_FAIL"))

            if stage_results["stage1"].get("face_crop_array") is not None:
                face_crop = stage_results["stage1"]["face_crop_array"]
                stage3_input = face_crop

        # ── Stages 2 & 3 — Forensics + GenD (run in parallel, ALWAYS) ──
        # For video, run forensics on the preview frame (not raw video bytes)
        if is_video and preview is not None:
            _, frame_jpg = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 95])
            forensic_bytes = frame_jpg.tobytes()
        else:
            forensic_bytes = media_bytes

        stage2_task = asyncio.to_thread(stage2_forensics.run_stage2, forensic_bytes)
        if stage3_input is not None:
            stage3_task = asyncio.to_thread(
                stage3_deepfake.run_stage3, stage3_input, gend_model, device
            )
            stage_results["stage2"], stage_results["stage3"] = await asyncio.gather(
                stage2_task, stage3_task
            )
        else:
            # No face crop available — still run forensics on the raw image
            stage_results["stage2"] = await stage2_task
            stage_results["stage3"] = {
                "passed": False,
                "reason": "NO_FACE_CROP_FOR_GEND",
                "fake_prob": None,
                "real_prob": None,
            }

        # Stage 2 forensic anomaly is a SOFT signal — don't add to hard
        # rejection_reasons.  Let stage5 scoring handle it via combined_score.
        # Only add truly blocking forensic errors (not FORENSIC_ANOMALY).
        stage2_reason = stage_results["stage2"].get("reason", "")
        if stage2_reason and stage2_reason != "FORENSIC_ANOMALY":
            rejection_reasons.append(stage2_reason)

        if not stage_results["stage3"].get("passed") and stage_results["stage3"].get("reason"):
            if stage_results["stage3"]["reason"] != "NO_FACE_CROP_FOR_GEND":
                rejection_reasons.append(stage_results["stage3"]["reason"])

        # ── Stage 4 — Identity Match ──────────────────────────────────
        id_bytes = id_document["bytes"] if id_document else None
        if face_crop is not None:
            stage_results["stage4"] = await asyncio.to_thread(
                stage4_identity.run_stage4,
                face_crop,
                id_bytes,
                uniface_models,
            )
        else:
            stage_results["stage4"] = {
                "passed": True,
                "skipped": True,
                "similarity": None,
            }

        if not stage_results["stage4"].get("passed"):
            rejection_reasons.append(stage_results["stage4"].get("reason", "IDENTITY_FAIL"))

        # ── Stage 5 — Risk Scoring ────────────────────────────────────
        stage_results["stage5"] = stage5_scoring.run_stage5(stage_results)

        # Override verdict if there were hard rejections from early stages
        if rejection_reasons:
            stage_results["stage5"]["verdict"] = "REJECTED"
            stage_results["stage5"]["risk_score"] = max(
                stage_results["stage5"].get("risk_score", 0), 75
            )
            if stage_results["stage5"]["risk_score"] >= 85:
                stage_results["stage5"]["risk_level"] = "critical"
            else:
                stage_results["stage5"]["risk_level"] = "high"

        return _build_final_report(stage_results, rejection_reasons, started_at, session_id)
    except Exception as exc:
        raise RuntimeError(f"Pipeline execution failed: {exc}") from exc


def _build_final_report(
    stage_results: dict[str, Any],
    rejection_reasons: list[str],
    started_at: float,
    session_id: Optional[str],
) -> dict[str, Any]:
    elapsed_ms = (time.perf_counter() - started_at) * 1000

    if "stage5" not in stage_results:
        stage_results["stage5"] = {
            "passed": True,
            "risk_score": 100,
            "risk_level": "critical",
            "verdict": "REJECTED",
        }

    return stage6_report.run_stage6(
        stage_results,
        stage_results["stage5"],
        total_time_ms=elapsed_ms,
        session_id=session_id,
    )
