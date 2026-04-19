from __future__ import annotations


def run_stage5(stage_results: dict) -> dict:
    try:
        gend_fake_prob = float(stage_results.get("stage3", {}).get("fake_prob", 0.0))
        forensics_score = float(stage_results.get("stage2", {}).get("combined_score", 0.0))
        arcface_similarity = stage_results.get("stage4", {}).get("similarity")
        arcface_similarity = 1.0 if arcface_similarity is None else float(arcface_similarity)
        exif_anomaly = float(stage_results.get("stage2", {}).get("sub_scores", {}).get("exif", 0.0))

        base_score = (
            (gend_fake_prob * 0.40)
            + (forensics_score * 0.30)
            + ((1.0 - arcface_similarity) * 0.20)
            + (exif_anomaly * 0.10)
        )

        # Force a high risk score if any single major heuristic screams "Synthetic/Anomaly"
        # This catches pure GenAI images (Midjourney) that bypass Deepfake FaceSwap detectors.
        raw_score = max(base_score, gend_fake_prob * 0.95, forensics_score * 0.95)

        risk_score = int(round(max(0.0, min(raw_score, 1.0)) * 100))
        if risk_score <= 25:
            return {"passed": True, "risk_score": risk_score, "risk_level": "low", "verdict": "APPROVED"}
        if risk_score <= 60:
            return {"passed": True, "risk_score": risk_score, "risk_level": "medium", "verdict": "FLAGGED"}
        if risk_score <= 85:
            return {"passed": True, "risk_score": risk_score, "risk_level": "high", "verdict": "FLAGGED"}
        return {"passed": True, "risk_score": risk_score, "risk_level": "critical", "verdict": "REJECTED"}
    except Exception as exc:
        return {"passed": False, "reason": f"STAGE5_ERROR: {exc}", "risk_score": 100, "risk_level": "critical", "verdict": "REJECTED"}
