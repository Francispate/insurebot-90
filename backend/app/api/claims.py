"""
backend/app/api/claims.py
Claims API routes
"""

import os
import re
from datetime import datetime
from fastapi import APIRouter, File, UploadFile, Depends, HTTPException, Form
from pydantic import BaseModel
from typing import Optional

from app.auth import get_current_user
from app.db.database import get_db
from app.ai.vision import analyze_damage_image
from app.ai.fraud import predict_fraud
from app.ai.settlement import predict_settlement

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


class SaveClaimRequest(BaseModel):
    claim_type: str
    description: str
    incident_date: str
    location: str
    amount_estimated: str
    damage_severity: str
    affected_parts: str
    fraud_risk_score: float
    fraud_label: str
    settlement_predicted: str
    settlement_confidence: float
    image_path: Optional[str] = ""


# ── Claim type mapping ────────────────────────────────────────────────────────
# Gemini can return many variants — map them all to a canonical value.
# Also used for encoding (float) passed to ML models.
_CLAIM_TYPE_ALIASES = {
    # car / vehicle
    "car":          ("car",          0.0),
    "vehicle":      ("car",          0.0),
    "auto":         ("car",          0.0),
    "automobile":   ("car",          0.0),
    "suv":          ("car",          0.0),
    "truck":        ("car",          0.0),
    "van":          ("car",          0.0),
    # two-wheeler — all common spellings/variants
    "two_wheeler":  ("two_wheeler",  0.25),
    "two wheeler":  ("two_wheeler",  0.25),
    "two-wheeler":  ("two_wheeler",  0.25),
    "2 wheeler":    ("two_wheeler",  0.25),
    "2-wheeler":    ("two_wheeler",  0.25),
    "2wheeler":     ("two_wheeler",  0.25),
    "bike":         ("two_wheeler",  0.25),
    "motorcycle":   ("two_wheeler",  0.25),
    "motorbike":    ("two_wheeler",  0.25),
    "scooter":      ("two_wheeler",  0.25),
    "moped":        ("two_wheeler",  0.25),
    "scooty":       ("two_wheeler",  0.25),
    "activa":       ("two_wheeler",  0.25),
    # house / property
    "house":        ("house",        0.5),
    "home":         ("house",        0.5),
    "property":     ("house",        0.5),
    "building":     ("house",        0.5),
    "apartment":    ("house",        0.5),
    "flat":         ("house",        0.5),
    # health
    "health":       ("health",       0.75),
    "medical":      ("health",       0.75),
    "personal":     ("health",       0.75),
    # business
    "business":     ("business",     1.0),
    "commercial":   ("business",     1.0),
    "shop":         ("business",     1.0),
    "office":       ("business",     1.0),
    # other
    "other":        ("other",        0.1),
}

def resolve_claim_type(raw: str):
    """
    Returns (canonical_label, encoded_float) from whatever Gemini returned.
    Tries exact match → partial match → keyword heuristic → last resort "car".
    """
    key = (raw or "").strip().lower()

    # Exact match
    if key in _CLAIM_TYPE_ALIASES:
        return _CLAIM_TYPE_ALIASES[key]

    # Partial match — e.g. "two-wheeler damage" or "motorcycle accident"
    for alias, result in _CLAIM_TYPE_ALIASES.items():
        if alias in key:
            return result

    # Keyword heuristics for common Gemini free-text responses
    if any(w in key for w in ("wheel", "cycle", "moto", "bike", "scoot", "moped")):
        return ("two_wheeler", 0.25)
    if any(w in key for w in ("house", "home", "flat", "apart", "build", "prop")):
        return ("house", 0.5)
    if any(w in key for w in ("health", "medic", "injur", "hospital")):
        return ("health", 0.75)
    if any(w in key for w in ("business", "commerc", "shop", "office")):
        return ("business", 1.0)

    return ("car", 0.0)   # last resort


# ── Feature helpers ───────────────────────────────────────────────────────────

def normalize_claim_amount(amount_str: str) -> float:
    try:
        numbers = re.findall(r'[\d,]+', amount_str.replace('₹', ''))
        if numbers:
            val = float(numbers[0].replace(',', ''))
            return min(val / 2_000_000, 1.0)
        return 0.3
    except Exception:
        return 0.3


def severity_to_float(severity: str) -> float:
    return {
        "minor":      0.25,
        "moderate":   0.50,
        "severe":     0.75,
        "total_loss": 1.00,
    }.get((severity or "").lower(), 0.5)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_claim(file: UploadFile = File(...)):
    """
    Analyze a damage image — no auth required.
    Calls vision.py → fraud.py → settlement.py
    Returns full analysis result.
    """
    try:
        image_bytes = await file.read()

        # Step 1 — Vision AI
        vision_result = analyze_damage_image(image_bytes)

        raw_claim_type  = vision_result.get("claim_type", "car")
        canonical_type, type_encoded = resolve_claim_type(raw_claim_type)
        # Write the canonical type back so the frontend shows it correctly
        vision_result["claim_type"] = canonical_type

        damage_severity  = vision_result.get("damage_severity", "moderate")
        estimated_amount = vision_result.get("estimated_amount", "0")

        # Step 2 — Fraud detection (7 features)
        fraud_features = [
            normalize_claim_amount(estimated_amount),   # claim_amount
            0.1,                                         # days_since_incident
            0.0,                                         # num_previous_claims
            type_encoded,                                # claim_type_encoded
            datetime.now().hour / 23,                    # hour_of_submission
            min(len(str(vision_result)) / 1000, 1.0),   # description_length
            0.8,                                         # photo_quality_score
        ]
        fraud_result = predict_fraud(fraud_features)

        # Step 3 — Settlement prediction (7 features)
        settlement_features = [
            normalize_claim_amount(estimated_amount),
            fraud_result.get("fraud_risk_score", 0) / 100,
            severity_to_float(damage_severity),
            0.8,                                         # documentation_completeness
            type_encoded,                                # claim_type_encoded
            0.1,                                         # days_to_report
            0.0,                                         # previous_claims_ratio
        ]
        settlement_result = predict_settlement(settlement_features)

        return {
            "success": True,
            "vision": vision_result,
            "fraud": fraud_result,
            "settlement": settlement_result,
        }

    except Exception as e:
        print(f"[Claims Analyze Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def save_claim(
    claim: SaveClaimRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        db = get_db()
        cur = db.execute("""
            INSERT INTO claims (
                user_id, claim_type, description, incident_date, location,
                amount_estimated, damage_severity, affected_parts,
                fraud_risk_score, fraud_label,
                settlement_predicted, settlement_confidence,
                status, image_path
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (
            current_user["id"], claim.claim_type, claim.description,
            claim.incident_date, claim.location, claim.amount_estimated,
            claim.damage_severity, claim.affected_parts,
            claim.fraud_risk_score, claim.fraud_label,
            claim.settlement_predicted, claim.settlement_confidence,
            "pending", claim.image_path,
        ))
        claim_id = cur.fetchone()["id"]
        db.commit()
        db.close()
        return {"success": True, "claim_id": claim_id, "status": "pending"}

    except Exception as e:
        print(f"[Save Claim Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def get_user_claims(current_user: dict = Depends(get_current_user)):
    try:
        db = get_db()
        claims = db.execute(
            "SELECT * FROM claims WHERE user_id = %s ORDER BY created_at DESC",
            (current_user["id"],)
        ).fetchall()
        db.close()
        return {"success": True, "claims": [dict(c) for c in claims]}
    except Exception as e:
        print(f"[Get Claims Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all")
async def get_all_claims(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        db = get_db()
        claims = db.execute("""
            SELECT c.*, u.name as user_name, u.email as user_email
            FROM claims c JOIN users u ON c.user_id = u.id
            ORDER BY c.created_at DESC
        """).fetchall()
        db.close()
        return {"success": True, "claims": [dict(c) for c in claims]}
    except Exception as e:
        print(f"[Get All Claims Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{claim_id}/status")
async def update_claim_status(
    claim_id: int,
    status: str = Form(...),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    valid = ["pending", "approved", "rejected", "investigating"]
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {valid}")
    try:
        db = get_db()
        db.execute("UPDATE claims SET status = %s WHERE id = %s", (status, claim_id))
        db.commit()
        db.close()
        return {"success": True, "claim_id": claim_id, "status": status}
    except Exception as e:
        print(f"[Update Status Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))
