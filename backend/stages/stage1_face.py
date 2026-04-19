from __future__ import annotations

from typing import Any

import cv2
import numpy as np


def run_stage1(image_bytes: bytes, uniface_models: Any) -> dict:
    try:
        image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return {"passed": False, "reason": "NO_FACE_DETECTED"}

        image_height, image_width = image.shape[:2]
        image_area = float(image_height * image_width)

        faces = uniface_models.detect_faces(image)
        if len(faces) == 0:
            return {"passed": False, "reason": "NO_FACE_DETECTED"}
        if len(faces) > 1:
            return {"passed": False, "reason": "MULTIPLE_FACES_DETECTED"}

        face = faces[0]
        x1, y1, x2, y2 = [int(value) for value in face["bbox"]]
        x1, y1 = max(x1, 0), max(y1, 0)
        x2, y2 = min(x2, image_width), min(y2, image_height)
        box_width = max(x2 - x1, 0)
        box_height = max(y2 - y1, 0)
        face_area = float(box_width * box_height)

        if face_area < image_area * 0.04:
            return {"passed": False, "reason": "FACE_BBOX_TOO_SMALL"}

        yaw = float(face.get("pose", {}).get("yaw", 0.0))
        if abs(yaw) > 30.0:
            return {"passed": False, "reason": "FACE_POSE_UNSUITABLE"}

        face_crop = image[y1:y2, x1:x2]
        if face_crop.size == 0:
            return {"passed": False, "reason": "NO_FACE_DETECTED"}

        # Liveness check — pass the full image + bbox to MiniFASNet
        bbox_for_spoofer = [x1, y1, x2, y2]
        liveness = face.get("liveness") or uniface_models.predict_liveness(image, bbox=bbox_for_spoofer)
        liveness_score = float(liveness.get("score", 0.0))
        label_idx = int(liveness.get("label_idx", 0))
        if label_idx == 0 or liveness_score < 0.55:
            return {"passed": False, "reason": "LIVENESS_FAIL"}

        return {
            "passed": True,
            "face_bbox": [x1, y1, x2, y2],
            "landmarks": face.get("landmarks", []),
            "face_area_ratio": face_area / image_area,
            "pose_yaw": yaw,
            "liveness_score": liveness_score,
            "face_crop_array": face_crop,
        }
    except Exception as exc:
        return {"passed": False, "reason": f"STAGE1_ERROR: {exc}"}
