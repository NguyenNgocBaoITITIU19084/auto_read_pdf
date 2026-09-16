from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.app.core.database import get_system_setting, set_system_setting
from backend.app.services.image_extractor import (
    verify_gemini_api_key, list_gemini_models, DEFAULT_MODEL
)

router = APIRouter(prefix="/settings", tags=["Settings"])

class AISettingsRequest(BaseModel):
    gemini_api_key: Optional[str] = None
    # None = keep the user's saved model (do not overwrite it with a default)
    gemini_model: Optional[str] = None
    ocr_engine: Optional[str] = None

class TestKeyRequest(BaseModel):
    gemini_api_key: str
    gemini_model: Optional[str] = None

@router.get("/ai")
def get_ai_settings():
    raw_key = get_system_setting("gemini_api_key", "")
    masked_key = ""
    if raw_key:
        if len(raw_key) > 8:
            masked_key = raw_key[:4] + "..." + raw_key[-4:]
        else:
            masked_key = "********"

    model = get_system_setting("gemini_model", DEFAULT_MODEL) or DEFAULT_MODEL
    engine = get_system_setting("ocr_engine", "auto")

    return {
        "has_key": bool(raw_key),
        "masked_key": masked_key,
        "raw_key": raw_key,
        "gemini_model": model,
        "ocr_engine": engine
    }

@router.post("/ai")
def update_ai_settings(req: AISettingsRequest):
    if req.gemini_api_key is not None:
        set_system_setting("gemini_api_key", req.gemini_api_key.strip())
    if req.gemini_model and req.gemini_model.strip():
        set_system_setting("gemini_model", req.gemini_model.strip())
    if req.ocr_engine and req.ocr_engine.strip():
        set_system_setting("ocr_engine", req.ocr_engine.strip())

    return {"status": "success", "message": "Settings updated"}

@router.get("/ai/models")
def get_ai_models(api_key: Optional[str] = Query(None, description="Gemini API key (defaults to saved key)")):
    """Lists Gemini models supporting generateContent; falls back to a static list on error."""
    key = (api_key or "").strip() or get_system_setting("gemini_api_key", "")
    models, _from_api = list_gemini_models(key)
    return {"models": models}

@router.post("/ai/test")
def test_ai_key(req: TestKeyRequest):
    key = req.gemini_api_key.strip() if req.gemini_api_key else ""
    if not key:
        key = get_system_setting("gemini_api_key", "")
    if not key:
        raise HTTPException(status_code=400, detail="No Gemini API Key provided")

    model = (req.gemini_model or "").strip() or get_system_setting("gemini_model", DEFAULT_MODEL) or DEFAULT_MODEL
    result = verify_gemini_api_key(key, model)
    return result
