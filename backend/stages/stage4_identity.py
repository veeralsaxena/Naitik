from __future__ import annotations

from typing import Any

import cv2
import numpy as np


def run_stage4(selfie_face_crop: np.ndarray, id_document_bytes: bytes | None, uniface_models: Any) -> dict:
    try:
        if id_document_bytes is None:
            return {"passed": True, "skipped": True, "similarity": None}

        id_document = cv2.imdecode(np.frombuffer(id_document_bytes, np.uint8), cv2.IMREAD_COLOR)
        if id_document is None:
            return {"passed": False, "reason": "ID_IMAGE_CORRUPTED"}

        faces = uniface_models.detect_faces(id_document)
        if not faces:
            return {"passed": False, "reason": "ID_NO_FACE"}

        x1, y1, x2, y2 = max(faces, key=lambda face: (face["bbox"][2] - face["bbox"][0]) * (face["bbox"][3] - face["bbox"][1]))["bbox"]
        id_face_crop = id_document[max(int(y1), 0) : min(int(y2), id_document.shape[0]), max(int(x1), 0) : min(int(x2), id_document.shape[1])]
        if id_face_crop.size == 0:
            return {"passed": False, "reason": "ID_NO_FACE"}

        selfie_embedding = uniface_models.embed_face(selfie_face_crop)
        id_embedding = uniface_models.embed_face(id_face_crop)
        similarity = float(np.dot(selfie_embedding, id_embedding) / ((np.linalg.norm(selfie_embedding) * np.linalg.norm(id_embedding)) + 1e-8))

        if similarity < 0.35:
            return {"passed": False, "reason": "ID_MISMATCH", "similarity": similarity}
        if similarity <= 0.50:
            return {"passed": True, "uncertain": True, "similarity": similarity}
        return {"passed": True, "uncertain": False, "similarity": similarity}
    except Exception as exc:
        return {"passed": False, "reason": f"STAGE4_ERROR: {exc}"}
