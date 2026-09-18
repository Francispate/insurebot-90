"""
backend/app/ai/vision.py
Analyzes damage images using Google Gemini API.

Features:
  - Multi-key rotation  (GEMINI_KEY_1 / GEMINI_KEY_2 / GEMINI_KEY_3)
  - Per-key retry with exponential back-off on 503 / 429
  - Automatic fallback to next key when current key exhausts retries
  - Falls back to static response only when ALL keys fail
"""

import os
import json
import time
import warnings
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv()

# ── Model ─────────────────────────────────────────────────────────────────────
# gemini-3.6-flash does NOT exist → causes 503/404.
# Use a real, stable model name.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# ── Key pool ──────────────────────────────────────────────────────────────────
# Collect every key that is actually set in the environment.
# You can add more by extending the list of env-var names.
_KEY_ENV_NAMES = ["GEMINI_KEY_1", "GEMINI_KEY_2", "GEMINI_KEY_3",
                  "GOOGLE_AI_API_KEY"]          # legacy fallback last

GEMINI_KEYS: list[str] = []
seen = set()
for _name in _KEY_ENV_NAMES:
    _k = os.getenv(_name, "").strip()
    if _k and _k not in seen:
        GEMINI_KEYS.append(_k)
        seen.add(_k)

# ── Retry config ──────────────────────────────────────────────────────────────
MAX_RETRIES_PER_KEY = 3        # how many times to retry a single key
BACKOFF_BASE_SECONDS = 2       # 2 → 4 → 8 seconds between retries
RETRYABLE_CODES = {503, 429}   # UNAVAILABLE + rate-limit

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
    Try every key in the pool, each with retries + back-off.
    Returns a parsed dict or the static fallback response.
    """
    if not GEMINI_KEYS:
        print("[Vision AI] No Gemini API keys found – using fallback")
        return _fallback_response()

    for key_idx, api_key in enumerate(GEMINI_KEYS, start=1):
        key_label = f"key #{key_idx}"
        result = _try_key(api_key, key_label, image_bytes)
        if result is not None:
            return result
        print(f"[Vision AI] {key_label} exhausted – trying next key...")

    print("[Vision AI] All keys failed – using fallback response")
    return _fallback_response()


# ── Internal helpers ──────────────────────────────────────────────────────────

def _try_key(api_key: str, key_label: str, image_bytes: bytes) -> dict | None:
    """
    Attempt to call Gemini with `api_key`.
    Retries up to MAX_RETRIES_PER_KEY times on 503/429.
    Returns parsed dict on success, None when this key should be abandoned.
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError as e:
        print(f"[Vision AI] google-genai not installed: {e}")
        return None

    client = genai.Client(api_key=api_key)

    for attempt in range(1, MAX_RETRIES_PER_KEY + 1):
        print(f"[Vision AI] {key_label} attempt {attempt}/{MAX_RETRIES_PER_KEY} "
              f"→ model={GEMINI_MODEL}")
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    _PROMPT,
                ]
            )

            raw = response.text.strip()
            print(f"[Vision AI] {key_label} raw (first 200 chars): {raw[:200]}")

            # Strip markdown fences if the model wrapped its reply
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
            retryable = _is_retryable(exc)
            print(f"[Vision AI] {key_label} attempt {attempt} failed – "
                  f"{type(exc).__name__}: {exc} "
                  f"({'retryable' if retryable else 'non-retryable'})")

            if not retryable:
                # Auth errors, bad request, etc. – no point retrying this key
                return None

            if attempt < MAX_RETRIES_PER_KEY:
                wait = BACKOFF_BASE_SECONDS ** attempt   # 2 → 4 → 8 s
                print(f"[Vision AI] {key_label} waiting {wait}s before retry…")
                time.sleep(wait)

    # Exhausted retries for this key
    return None


def _is_retryable(exc: Exception) -> bool:
    """Return True if the error is transient and worth retrying."""
    msg = str(exc).lower()
    # google-genai raises ServerError with the HTTP status in the message
    for code in RETRYABLE_CODES:
        if str(code) in msg:
            return True
    # Also catch generic transient keywords
    transient_keywords = ("unavailable", "rate limit", "quota", "too many requests",
                          "timeout", "deadline exceeded")
    return any(kw in msg for kw in transient_keywords)


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
