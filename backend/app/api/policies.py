"""
backend/app/api/policies.py
Policies API routes
"""

import json
from datetime import datetime
from fastapi import APIRouter, File, UploadFile, Depends, HTTPException, Form
from typing import Optional
from pydantic import BaseModel

from app.auth import get_current_user
from app.db.database import get_db
from app.ai.policy_analyzer import extract_pdf_text, analyze_policy_text
from app.ai.advisor import get_preclaim_advice
from app.ai.web_search import search_insurance_info

router = APIRouter()


class AdviceRequest(BaseModel):
    claim_type: str
    description: str
    policy_details: Optional[str] = ""


@router.post("/analyze")
async def analyze_policy(
    file: Optional[UploadFile] = File(None),
    policy_text: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload and analyze a policy PDF or raw text — auth required.
    Saves result to policies table.
    """
    try:
        extracted_text = ""
        filename = "manual_input"

        if file and file.filename:
            pdf_bytes = await file.read()
            extracted_text = extract_pdf_text(pdf_bytes)
            filename = file.filename
        elif policy_text:
            extracted_text = policy_text
        else:
            raise HTTPException(status_code=400, detail="Provide a PDF file or policy text")

        if not extracted_text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from the provided input")

        # Analyze with Groq
        analysis = analyze_policy_text(extracted_text)

        # If the model determined this isn't an insurance/banking document,
        # don't save it and just return the message — nothing to analyze.
        if analysis.get("is_insurance_document") is False:
            return {
                "success": True,
                "filename": filename,
                "analysis": analysis
            }

        analysis_json = json.dumps(analysis)
        summary = analysis.get("policy_summary", "")

        # Save to database
        db = get_db()
        db.execute("""
            INSERT INTO policies (user_id, filename, summary, analysis_json)
            VALUES (%s, %s, %s, %s)
        """, (
            current_user["id"],
            filename,
            summary,
            analysis_json
        ))
        db.commit()
        db.close()

        return {
            "success": True,
            "filename": filename,
            "analysis": analysis
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Policy Analyze Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/advice")
async def get_advice(
    request: AdviceRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Get pre-claim advice + web search results — auth required.
    """
    try:
        # Get AI advice
        advice = get_preclaim_advice(
            claim_type=request.claim_type,
            description=request.description,
            policy_details=request.policy_details or ""
        )

        # Get web search results
        search_query = f"{request.claim_type} insurance claim {request.description[:50]}"
        search_results = search_insurance_info(search_query)

        return {
            "success": True,
            "advice": advice,
            "search_results": search_results
        }

    except Exception as e:
        print(f"[Policy Advice Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def get_user_policies(current_user: dict = Depends(get_current_user)):
    """Get all policies for the current logged-in user."""
    try:
        db = get_db()
        policies = db.execute("""
            SELECT id, user_id, filename, summary, uploaded_at
            FROM policies
            WHERE user_id = %s
            ORDER BY uploaded_at DESC
        """, (current_user["id"],)).fetchall()
        db.close()

        return {"success": True, "policies": [dict(p) for p in policies]}

    except Exception as e:
        print(f"[Get Policies Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))