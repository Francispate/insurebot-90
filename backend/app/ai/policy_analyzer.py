"""
backend/app/ai/policy_analyzer.py
Extracts text from policy PDFs and analyzes using Groq API
"""

import os
import json
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """
    Extract text from a PDF using PyMuPDF (fitz).
    Returns max 8000 characters of text.
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
            if len(text) >= 8000:
                break
        doc.close()
        return text[:8000].strip()

    except Exception as e:
        print(f"[PDF Extraction Error] {e}")
        return ""


def analyze_policy_text(text: str) -> dict:
    """
    Analyze extracted policy text using Groq.
    Returns structured policy analysis.
    """

    if not GROQ_API_KEY or not text:
        return _fallback_analysis()

    try:
        from groq import Groq

        client = Groq(api_key=GROQ_API_KEY)

        prompt = f"""You are an expert Indian insurance policy analyzer.

First, determine whether the text below is actually an insurance or banking policy
document (e.g. car/health/life/home insurance policy, terms of coverage, a bank
loan/account agreement, etc). It does NOT need to be Indian-specific to count.

If it is NOT such a document (e.g. it's a resume, a novel, an invoice, lecture notes,
a random article, code, etc), respond ONLY with this JSON and nothing else:
{{
  "is_insurance_document": false,
  "document_type_detected": "a short plain-English guess at what the document actually is"
}}

If it IS an insurance/banking policy document, analyze it and respond ONLY with a
valid JSON object in this format. No explanation, no markdown, just raw JSON.

Policy Text:
{text[:7000]}

JSON format:
{{
  "is_insurance_document": true,
  "policy_summary": "2-3 sentence plain English summary of what this policy is",
  "what_is_covered": ["item1", "item2", "item3", "item4", "item5"],
  "what_is_NOT_covered": ["item1", "item2", "item3", "item4", "item5"],
  "hidden_benefits": ["benefit1", "benefit2", "benefit3"],
  "dangerous_clauses": ["clause1", "clause2", "clause3"],
  "overall_rating": 7.5,
  "rating_reasoning": "2-3 sentence explanation of why this specific rating was given, referencing the actual coverage, exclusions, and dangerous clauses found"
}}

Rules:
- policy_summary: simple language any Indian can understand
- what_is_covered: at least 5 specific items covered
- what_is_NOT_covered: at least 5 specific exclusions
- hidden_benefits: lesser-known benefits most people miss
- dangerous_clauses: clauses that could hurt the policyholder
- overall_rating: float from 1.0 to 10.0 based on how good this policy is for the customer
- rating_reasoning: must directly justify the number — mention specific strengths that pushed it up and specific weaknesses (exclusions, dangerous clauses, low coverage) that pulled it down"""

        response = client.chat.completions.create(
                model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1200,
            temperature=0.3
        )

        raw = response.choices[0].message.content.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        result = json.loads(raw)

        # Model explicitly flagged this as not an insurance/banking document
        if result.get("is_insurance_document") is False:
            doc_type = result.get("document_type_detected", "an unrelated document")
            return {
                "is_insurance_document": False,
                "document_type_detected": doc_type,
                "message": (
                    f"This looks like {doc_type}, not an insurance or banking policy "
                    "document. It can't be analyzed for coverage, exclusions, or risk — "
                    "please upload an actual policy document."
                )
            }

        result.setdefault("is_insurance_document", True)
        return result

    except Exception as e:
        print(f"[Policy Analyzer Error] {e}")
        return _fallback_analysis()


def _fallback_analysis() -> dict:
    return {
        "is_insurance_document": True,
        "policy_summary": "This appears to be a standard Indian insurance policy. Upload your policy document for a detailed AI-powered analysis of your specific coverage.",
        "what_is_covered": [
            "Accidental damage",
            "Natural disasters (fire, flood, earthquake)",
            "Theft and burglary",
            "Third-party liability",
            "Emergency hospitalization"
        ],
        "what_is_NOT_covered": [
            "Pre-existing conditions (during waiting period)",
            "Wear and tear / depreciation",
            "Intentional damage",
            "War and nuclear perils",
            "Unlicensed driver claims (motor)"
        ],
        "hidden_benefits": [
            "No-claim bonus (NCB) discount on renewal",
            "Free annual health check-up",
            "Roadside assistance coverage"
        ],
        "dangerous_clauses": [
            "Sub-limits on room rent may reduce total claim payout",
            "Co-payment clause requires you to pay a portion of claim",
            "Waiting period for specific diseases"
        ],
        "overall_rating": 6.5,
        "rating_reasoning": "This is a generic fallback estimate (no AI analysis was available) — it assumes typical coverage balanced against typical exclusions and sub-limits common to standard Indian policies."
    }