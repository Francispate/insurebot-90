"""
backend/app/ai/fraud.py
Fraud detection using trained RandomForest model
"""

import os
import joblib
import numpy as np

# Model paths — works locally and on Render
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(BASE_DIR, "models", "fraud_model.pkl")
SCALER_PATH = os.path.join(BASE_DIR, "models", "fraud_scaler.pkl")

_model = None
_scaler = None


def _load_models():
    global _model, _scaler
    if _model is None:
        try:
            _model = joblib.load(MODEL_PATH)
            _scaler = joblib.load(SCALER_PATH)
            print("[Fraud Model] Loaded successfully")
        except Exception as e:
            print(f"[Fraud Model] Failed to load: {e}")
            _model = None
            _scaler = None


def predict_fraud(features: list) -> dict:
    """
    Predict fraud risk from exactly 7 normalized features:
    1. claim_amount (normalized 0-1)
    2. days_since_incident (normalized 0-1)
    3. num_previous_claims (normalized 0-1)
    4. claim_type_encoded (car=0, house=0.33, health=0.66, business=1)
    5. hour_of_submission (normalized 0-1)
    6. description_length (normalized 0-1)
    7. photo_quality_score (normalized 0-1)

    Returns: fraud_risk_score (0-100), fraud_label, requires_investigation
    """
    _load_models()

    if _model is None or _scaler is None:
        return _fallback_response()

    try:
        X = np.array(features).reshape(1, -1)
        X_scaled = _scaler.transform(X)

        # Get fraud probability
        proba = _model.predict_proba(X_scaled)[0]
        # Class order: genuine=0, fraud=1
        fraud_prob = proba[1]
        fraud_risk_score = round(fraud_prob * 100, 1)

        prediction = _model.predict(X_scaled)[0]
        fraud_label = "fraud" if prediction == 1 else "genuine"
        requires_investigation = fraud_risk_score >= 60

        return {
            "fraud_risk_score": float(fraud_risk_score),
            "fraud_label": str(fraud_label),
            "requires_investigation": bool(requires_investigation)
        }

    except Exception as e:
        print(f"[Fraud Prediction Error] {e}")
        return _fallback_response()


def _fallback_response() -> dict:
    return {
        "fraud_risk_score": 15.0,
        "fraud_label": "genuine",
        "requires_investigation": False
    }
