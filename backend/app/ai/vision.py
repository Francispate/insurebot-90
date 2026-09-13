"""
backend/app/ai/vision.py
Analyzes damage images using Google Gemini API
"""

import os
import json
import warnings
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv()

GOOGLE_AI_API_KEY = os.getenv("GOOGLE_AI_API_KEY", "")


def analyze_damage_image(image_bytes: bytes) -> dict:
    if not GOOGLE_AI_API_KEY:
        print("[Vision AI] No API key found, using fallback")
        return _fallback_response()

    try:
        from google import genai
        from google.genai import types

        print("[Vision AI] Connecting to Gemini...")

        client = genai.Client(api_key=GOOGLE_AI_API_KEY)

        prompt = """You are an insurance damage assessment AI for an Indian insurance platform.
Analyze this damage image and respond ONLY with a valid JSON object.
No explanation, no markdown, just raw JSON.

JSON format:
{
  "claim_type": "car" or "house" or "health" or "business",
  "damage_severity": "minor" or "moderate" or "severe" or "total_loss",
  "estimated_amount": "rupees X to Y",
  "affected_parts": ["part1", "part2", "part3"],
  "documentation_needed": ["doc1", "doc2", "doc3"],
  "rejection_risks": ["risk1", "risk2"]
}

Rules:
- estimated_amount must use realistic Indian Rupee amounts
- affected_parts: list the specific damaged areas visible
- documentation_needed: list documents required to file this claim in India
- rejection_risks: list reasons this claim might be rejected
"""

        print("[Vision AI] Sending image to Gemini 3.6 Flash...")

        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                prompt
            ]
        )

        print("[Vision AI] Response received, parsing...")

        raw = response.text.strip()
        print(f"[Vision AI] Raw response: {raw[:200]}")

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        result = json.loads(raw)
        print("[Vision AI] Successfully parsed JSON")
        return result

    except Exception as e:
        print(f"[Vision AI Error] {type(e).__name__}: {e}")
        return _fallback_response()


def _fallback_response() -> dict:
    return {
        "claim_type": "car",
        "damage_severity": "moderate",
        "estimated_amount": "25000 to 75000",
        "affected_parts": ["Front bumper", "Hood", "Headlights"],
        "documentation_needed": [
            "FIR copy",
            "RC book",
            "Driving license",
            "Insurance policy document",
            "Repair estimate from garage"
        ],
        "rejection_risks": [
            "Driving under influence",
            "Policy lapse at time of incident"
        ]
    }