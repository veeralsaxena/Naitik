from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from forensic_engine import run_pipeline
from models import model_loader


@asynccontextmanager
async def lifespan(_: FastAPI):
    model_loader.load_gend_model()
    model_loader.load_uniface_models()
    yield


app = FastAPI(
    title="Naitik Forensic Engine",
    version="1.0.0",
    description="Local-first KYC forensic engine for deepfake and identity verification.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def get_health() -> dict:
    return model_loader.get_status()


@app.post("/verify/media")
async def verify_media(
    media_file: UploadFile = File(...),
    id_document: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
) -> dict:
    try:
        media_payload = {
            "filename": media_file.filename or "upload.bin",
            "content_type": media_file.content_type,
            "bytes": await media_file.read(),
        }
        id_payload = None
        if id_document is not None:
            id_payload = {
                "filename": id_document.filename or "document.bin",
                "content_type": id_document.content_type,
                "bytes": await id_document.read(),
            }

        return await run_pipeline(media_payload, id_payload, session_id=session_id)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - FastAPI surface
        raise HTTPException(status_code=500, detail=str(exc)) from exc
