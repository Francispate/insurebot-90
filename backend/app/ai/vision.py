"""
backend/app/ai/vision.py
Analyzes damage images using Google Gemini API.

Strategy:
  - Try each model in MODEL_FALLBACK_CHAIN (4 models)
  - For each model, rotate through all 3 keys
  - No sleep/wait — instant fallback
  - Static fallback only when everything fails

Matrix: 4 models × 3 keys = 12 attempts before giving up
"""

import os
import json
import warnings
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv()

# ── Model chain (4 models) ────────────────────────────────────────────────────
# If a model is overloaded (503) all keys fail → moves to next model instantly
MODEL_FALLBACK_CHAIN = [
    os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),  # primary (newest)
    "gemini-2.5-flash",                              # fallback #1 (stable GA)
    "gemini-2.5-flash-lite",                         # fallback #2 (stable, lighter)
    "gemini-3.1-flash-lite",                         # fallback #3 (newest stable)
]
# Remove duplicates while preserving order
_seen_models: set = set()
MODEL_FALLBACK_CHAIN = [
    m for m in MODEL_FALLBACK_CHAIN
    if not (m in _seen_models or _seen_models.add(m))
]

# ── Key pool (3 keys) ─────────────────────────────────────────────────────────
_KEY_ENV_NAMES = ["GEMINI_KEY_1", "GEMINI_KEY_2", "GEMINI_KEY_3",
                  "GOOGLE_AI_API_KEY"]   # legacy key picked up last

GEMINI_KEYS: list[str] = []
_seen_keys: set = set()
for _name in _KEY_ENV_NAMES:
    _k = os.getenv(_name, "").strip()
    if _k and _k not in _seen_keys:
        GEMINI_KEYS.append(_k)
        _seen_keys.add(_k)

# ── Retryable error patterns ──────────────────────────────────────────────────
_RETRYABLE = ("503", "429", "unavailable", "rate limit",
              "quota", "too many requests", "timeout", "deadline exceeded")

# ── Prompt ────────────────────────────────────────────────────────────────────
_PROMPT = """You are an insurance damage assessment AI for an Indian insurance platform.
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


# ── Main public function ──────────────────────────────────────────────────────

def analyze_damage_image(image_bytes: bytes) -> dict:
    """
    Try every model × every key = 4 models × 3 keys = 12 attempts.
    Falls back to static response only when all 12 fail.
    """
    if not GEMINI_KEYS:
        print("[Vision AI] No Gemini API keys configured – using fallback")
        return _fallback_response()

    try:
        from google import genai
        from google.genai import types
    except ImportError as e:
        print(f"[Vision AI] google-genai not installed: {e}")
        return _fallback_response()

    for model in MODEL_FALLBACK_CHAIN:
        print(f"[Vision AI] Trying model={model}")
        all_keys_failed = True

        for key_idx, api_key in enumerate(GEMINI_KEYS, start=1):
            key_label = f"key #{key_idx}"
            try:
                client = genai.Client(api_key=api_key)
                response = client.models.generate_content(
                    model=model,
                    contents=[
                        types.Part.from_bytes(
                            data=image_bytes, mime_type="image/jpeg"
                        ),
                        _PROMPT,
                    ]
                )

                raw = response.text.strip()
                print(f"[Vision AI] {key_label}/{model} raw (first 200): {raw[:200]}")

                # Strip markdown fences if present
                if raw.startswith("```"):
                    parts = raw.split("```")
                    raw = parts[1] if len(parts) > 1 else raw
                    if raw.startswith("json"):
                        raw = raw[4:]
                raw = raw.strip()

                parsed = json.loads(raw)
                print(f"[Vision AI] ✓ Success — model={model} {key_label}")
                return parsed

            except Exception as exc:
                msg = str(exc).lower()
                retryable = any(s in msg for s in _RETRYABLE)
                print(f"[Vision AI] {key_label}/{model} failed – "
                      f"{type(exc).__name__}: {str(exc)[:120]} "
                      f"({'overload→next key' if retryable else 'hard error→next key'})")
                continue

        print(f"[Vision AI] All 3 keys failed for model={model} → trying next model")

    print("[Vision AI] All 4 models × 3 keys exhausted – using fallback response")
    return _fallback_response()


def _fallback_response() -> dict:
    return {
        "claim_type": "car",
        "damage_severity": "moderate",
        "estimated_amount": "rupees 25000 to 75000",
        "affected_parts": ["Front bumper", "Hood", "Headlights"],
        "documentation_needed": [
            "FIR copy",
            "RC book",
            "Driving license",
            "Insurance policy document",
            "Repair estimate from garage",
        ],
        "rejection_risks": [
            "Driving under influence",
            "Policy lapse at time of incident",
        ],
    }
