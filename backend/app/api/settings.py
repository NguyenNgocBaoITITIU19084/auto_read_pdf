from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.core.database import get_system_setting, set_system_setting
from backend.app.services.image_extractor import verify_gemini_api_key

router = APIRouter(prefix="/settings", tags=["Settings"])

class AISettingsRequest(BaseModel):
    gemini_api_key: Optional[str] = None
    gemini_model: Optional[str] = "gemini-2.0-flash"
    ocr_engine: Optional[str] = "auto"

class TestKeyRequest(BaseModel):
    gemini_api_key: str
    gemini_model: Optional[str] = "gemini-2.0-flash"

@router.get("/ai")
def get_ai_settings():
    raw_key = get_system_setting("gemini_api_key", "")
    masked_key = ""
    if raw_key:
        if len(raw_key) > 8:
            masked_key = raw_key[:4] + "..." + raw_key[-4:]
        else:
            masked_key = "********"
            
    model = get_system_setting("gemini_model", "gemini-2.0-flash")
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
    if req.gemini_model:
        set_system_setting("gemini_model", req.gemini_model.strip())
    if req.ocr_engine:
        set_system_setting("ocr_engine", req.ocr_engine.strip())
        
    return {"status": "success", "message": "Settings updated"}

@router.post("/ai/test")
def test_ai_key(req: TestKeyRequest):
    key = req.gemini_api_key.strip() if req.gemini_api_key else ""
    if not key:
        key = get_system_setting("gemini_api_key", "")
    if not key:
        raise HTTPException(status_code=400, detail="No Gemini API Key provided")
        
    result = verify_gemini_api_key(key, req.gemini_model or "gemini-2.0-flash")
    return result

