"""
backend/app/ai/vision.py
Analyzes damage images using Google Gemini API.

Features:
  - Multi-key rotation  (GEMINI_KEY_1 / GEMINI_KEY_2 / GEMINI_KEY_3)
  - Instant key rotation on 503/429 — NO sleep/wait (claims must not hang)
  - Non-retryable errors (404, 401) skip to next key immediately
  - Falls back to static response only when ALL keys fail
"""

import os
import json
import warnings
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv()

# ── Model ─────────────────────────────────────────────────────────────────────
# gemini-2.0-flash was shut down June 1 2026.
# gemini-3.6-flash is the current recommended model per Google's own error msg.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

# ── Key pool ──────────────────────────────────────────────────────────────────
_KEY_ENV_NAMES = ["GEMINI_KEY_1", "GEMINI_KEY_2", "GEMINI_KEY_3",
                  "GOOGLE_AI_API_KEY"]   # legacy key picked up last

GEMINI_KEYS: list[str] = []
_seen = set()
for _name in _KEY_ENV_NAMES:
    _k = os.getenv(_name, "").strip()
    if _k and _k not in _seen:
        GEMINI_KEYS.append(_k)
        _seen.add(_k)

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

# ── Errors that are worth trying the next key for ─────────────────────────────
_RETRYABLE_SNIPPETS = ("503", "429", "unavailable", "rate limit",
                       "quota", "too many requests", "timeout",
                       "deadline exceeded")


# ── Main public function ──────────────────────────────────────────────────────

def analyze_damage_image(image_bytes: bytes) -> dict:
    """
    Try every key in the pool once (no sleep/wait between attempts).
    Returns a parsed dict on first success, or the static fallback.
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

    for key_idx, api_key in enumerate(GEMINI_KEYS, start=1):
        key_label = f"key #{key_idx}"
        print(f"[Vision AI] Trying {key_label} → model={GEMINI_MODEL}")
        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    _PROMPT,
                ]
            )

            raw = response.text.strip()
            print(f"[Vision AI] {key_label} raw (first 200): {raw[:200]}")

            # Strip markdown fences if present
            if raw.startswith("```"):
                parts = raw.split("```")
                raw = parts[1] if len(parts) > 1 else raw
                if raw.startswith("json"):
                    raw = raw[4:]
            raw = raw.strip()

            parsed = json.loads(raw)
            print(f"[Vision AI] {key_label} success ✓")
            return parsed

        except Exception as exc:
            msg = str(exc).lower()
            retryable = any(s in msg for s in _RETRYABLE_SNIPPETS)
            print(f"[Vision AI] {key_label} failed – "
                  f"{type(exc).__name__}: {exc} "
                  f"({'trying next key' if retryable else 'non-retryable, skipping'})")

            if not retryable:
                # 404 wrong model, 401 bad key — no point trying same key again,
                # but a different key might work (different quota/region).
                continue

            # 503/429 — move straight to next key, no sleep
            continue

    print("[Vision AI] All keys failed – using fallback response")
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
