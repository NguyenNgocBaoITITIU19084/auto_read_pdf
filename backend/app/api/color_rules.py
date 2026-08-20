from typing import Optional, List
from fastapi import APIRouter, HTTPException
from backend.app.schemas.models import ColorRuleCreate, ColorRuleUpdate, ColorRuleResponse
from backend.app.core.database import (
    get_color_rules, create_color_rule, update_color_rule,
    delete_color_rule, reset_color_rules_to_default
)

router = APIRouter(prefix="/color-rules", tags=["Color Rules"])

@router.get("", response_model=List[ColorRuleResponse])
def list_color_rules(target_table: Optional[str] = None):
    try:
        rules = get_color_rules(target_table)
        return rules
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch color rules: {e}")

@router.post("", response_model=ColorRuleResponse)
def add_color_rule(payload: ColorRuleCreate):
    try:
        rule_id = create_color_rule(payload.model_dump())
        rules = get_color_rules()
        created = next((r for r in rules if r["id"] == rule_id), None)
        if not created:
            raise HTTPException(status_code=500, detail="Rule created but could not be retrieved")
        return created
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create color rule: {e}")

@router.put("/{rule_id}", response_model=ColorRuleResponse)
def edit_color_rule(rule_id: int, payload: ColorRuleUpdate):
    try:
        success = update_color_rule(rule_id, payload.model_dump(exclude_unset=True))
        if not success:
            raise HTTPException(status_code=404, detail="Color rule not found or no changes made")
        rules = get_color_rules()
        updated = next((r for r in rules if r["id"] == rule_id), None)
        if not updated:
            raise HTTPException(status_code=404, detail="Color rule not found")
        return updated
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to update color rule: {e}")

@router.delete("/{rule_id}")
def remove_color_rule(rule_id: int):
    try:
        success = delete_color_rule(rule_id)
        if not success:
            raise HTTPException(status_code=404, detail="Color rule not found")
        return {"status": "success", "message": "Color rule deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to delete color rule: {e}")

@router.post("/reset", response_model=List[ColorRuleResponse])
def reset_color_rules():
    try:
        rules = reset_color_rules_to_default()
        return rules
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset color rules: {e}")
