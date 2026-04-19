from __future__ import annotations


def run_stage5(stage_results: dict) -> dict:
    try:
        gend_fake_prob = float(stage_results.get("stage3", {}).get("fake_prob", 0.0))
        forensics_score = float(stage_results.get("stage2", {}).get("combined_score", 0.0))
        arcface_similarity = stage_results.get("stage4", {}).get("similarity")
        arcface_similarity = 1.0 if arcface_similarity is None else float(arcface_similarity)
        exif_anomaly = float(stage_results.get("stage2", {}).get("sub_scores", {}).get("exif", 0.0))
        genai_texture = float(stage_results.get("stage2", {}).get("sub_scores", {}).get("genai_texture", 0.0))

        base_score = (
            (gend_fake_prob * 0.25)
            + (forensics_score * 0.15)
            + (genai_texture * 0.30)
            + ((1.0 - arcface_similarity) * 0.15)
            + (exif_anomaly * 0.15)
        )

        # Allow any single strong signal to dominate the final score
        raw_score = max(base_score, gend_fake_prob * 0.90, genai_texture * 0.92)

        risk_score = int(round(max(0.0, min(raw_score, 1.0)) * 100))

        # Store genai_texture in stage_results so the report can reference it
        stage_results.setdefault("stage5_meta", {})["genai_texture_score"] = genai_texture

        if risk_score <= 25:
            return {"passed": True, "risk_score": risk_score, "risk_level": "low", "verdict": "APPROVED"}
        if risk_score <= 60:
            return {"passed": True, "risk_score": risk_score, "risk_level": "medium", "verdict": "FLAGGED"}
        if risk_score <= 85:
            return {"passed": True, "risk_score": risk_score, "risk_level": "high", "verdict": "FLAGGED"}
        return {"passed": True, "risk_score": risk_score, "risk_level": "critical", "verdict": "REJECTED"}
    except Exception as exc:
        return {"passed": False, "reason": f"STAGE5_ERROR: {exc}", "risk_score": 100, "risk_level": "critical", "verdict": "REJECTED"}
