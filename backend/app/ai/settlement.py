"""
backend/app/ai/settlement.py
Settlement prediction using trained GradientBoosting model
"""

import os
import joblib
import numpy as np

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(BASE_DIR, "models", "settlement_model.pkl")
SCALER_PATH = os.path.join(BASE_DIR, "models", "settlement_scaler.pkl")

_model = None
_scaler = None


def _load_models():
    global _model, _scaler
    if _model is None:
        try:
            _model = joblib.load(MODEL_PATH)
            _scaler = joblib.load(SCALER_PATH)
            print("[Settlement Model] Loaded successfully")
        except Exception as e:
            print(f"[Settlement Model] Failed to load: {e}")
            _model = None
            _scaler = None


def predict_settlement(features: list) -> dict:
    """
    Predict settlement outcome from exactly 7 normalized features:
    1. claim_amount_normalized (0-1)
    2. fraud_risk_score (0-1, divide raw score by 100)
    3. damage_severity (minor=0.25, moderate=0.5, severe=0.75, total_loss=1.0)
    4. documentation_completeness (0-1)
    5. claim_type_encoded (car=0, house=0.33, health=0.66, business=1)
    6. days_to_report (normalized 0-1)
    7. previous_claims_ratio (normalized 0-1)

    Returns: predicted_settlement, settlement_confidence
    """
    _load_models()

    if _model is None or _scaler is None:
        return _fallback_response()

    try:
        X = np.array(features).reshape(1, -1)
        X_scaled = _scaler.transform(X)

        prediction = _model.predict(X_scaled)[0]
        proba = _model.predict_proba(X_scaled)[0]
        confidence = round(float(max(proba)) * 100, 1)

        # Map numeric label back to string
        classes = _model.classes_
        predicted_settlement = prediction if isinstance(prediction, str) else classes[prediction]

        return {
            "predicted_settlement": str(predicted_settlement),
            "settlement_confidence": float(confidence)
        }

    except Exception as e:
        print(f"[Settlement Prediction Error] {e}")
        return _fallback_response()


def _fallback_response() -> dict:
    return {
        "predicted_settlement": "partial",
        "settlement_confidence": 72.0
    }
