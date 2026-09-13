"""
backend/training/train_models.py
Run once on your PC to generate .pkl files.

Usage:
    cd backend
    venv\Scripts\activate
    python training/train_models.py
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib
import os

os.makedirs("models", exist_ok=True)

np.random.seed(42)
N = 2000

print("=" * 50)
print("InsureBot Model Trainer")
print("=" * 50)


# ─────────────────────────────────────────────────
# FRAUD DETECTION MODEL
# Features (all normalized 0-1, exactly 7):
# 0: claim_amount
# 1: days_since_incident
# 2: num_previous_claims
# 3: claim_type_encoded
# 4: hour_of_submission
# 5: description_length
# 6: photo_quality_score
# ─────────────────────────────────────────────────
print("\n[1/2] Training Fraud Detection Model...")


def generate_fraud_data(n):
    X = np.zeros((n, 7))
    y = np.zeros(n, dtype=int)

    for i in range(n):
        is_fraud = np.random.random() < 0.2

        if is_fraud:
            X[i, 0] = np.random.uniform(0.6, 1.0)
            X[i, 1] = np.random.uniform(0.0, 0.2)
            if np.random.random() < 0.5:
                X[i, 1] = np.random.uniform(0.8, 1.0)
            X[i, 2] = np.random.uniform(0.5, 1.0)
            X[i, 3] = np.random.uniform(0.0, 1.0)
            X[i, 4] = np.random.uniform(0.7, 1.0)
            X[i, 5] = np.random.uniform(0.0, 0.3)
            X[i, 6] = np.random.uniform(0.0, 0.4)
            y[i] = 1
        else:
            X[i, 0] = np.random.uniform(0.05, 0.6)
            X[i, 1] = np.random.uniform(0.1, 0.6)
            X[i, 2] = np.random.uniform(0.0, 0.4)
            X[i, 3] = np.random.uniform(0.0, 1.0)
            X[i, 4] = np.random.uniform(0.1, 0.7)
            X[i, 5] = np.random.uniform(0.4, 1.0)
            X[i, 6] = np.random.uniform(0.5, 1.0)
            y[i] = 0

    noise = np.random.normal(0, 0.05, X.shape)
    X = np.clip(X + noise, 0, 1)
    return X, y


X_fraud, y_fraud = generate_fraud_data(N)
X_train, X_test, y_train, y_test = train_test_split(
    X_fraud, y_fraud, test_size=0.2, random_state=42
)

fraud_scaler = StandardScaler()
X_train_scaled = fraud_scaler.fit_transform(X_train)
X_test_scaled = fraud_scaler.transform(X_test)

fraud_model = RandomForestClassifier(
    n_estimators=100,
    max_depth=8,
    class_weight="balanced",
    random_state=42
)
fraud_model.fit(X_train_scaled, y_train)

y_pred = fraud_model.predict(X_test_scaled)
print(classification_report(y_test, y_pred, target_names=["genuine", "fraud"]))

joblib.dump(fraud_model, "models/fraud_model.pkl")
joblib.dump(fraud_scaler, "models/fraud_scaler.pkl")
print("Saved: fraud_model.pkl + fraud_scaler.pkl")


# ─────────────────────────────────────────────────
# SETTLEMENT PREDICTION MODEL
# Features (all normalized 0-1, exactly 7):
# 0: claim_amount_normalized
# 1: fraud_risk_score
# 2: damage_severity
# 3: documentation_completeness
# 4: claim_type_encoded
# 5: days_to_report
# 6: previous_claims_ratio
# ─────────────────────────────────────────────────
print("\n[2/2] Training Settlement Prediction Model...")


def generate_settlement_data(n):
    X = np.zeros((n, 7))
    y = []

    for i in range(n):
        amount      = np.random.uniform(0.0, 1.0)
        fraud_risk  = np.random.uniform(0.0, 1.0)
        severity    = np.random.uniform(0.0, 1.0)
        docs        = np.random.uniform(0.0, 1.0)
        claim_type  = np.random.choice([0.0, 0.33, 0.66, 1.0])
        days_to_rep = np.random.uniform(0.0, 1.0)
        prev_claims = np.random.uniform(0.0, 1.0)

        X[i] = [amount, fraud_risk, severity, docs,
                claim_type, days_to_rep, prev_claims]

        if fraud_risk > 0.7:
            label = "rejected"
        elif docs < 0.3:
            label = "rejected" if np.random.random() < 0.5 else "partial"
        elif days_to_rep > 0.8:
            label = "partial"
        elif severity > 0.6 and docs > 0.6 and fraud_risk < 0.3:
            label = "full"
        elif docs > 0.5 and fraud_risk < 0.5:
            label = "full" if np.random.random() < 0.6 else "partial"
        else:
            label = "partial"

        y.append(label)

    return X, np.array(y)


X_sett, y_sett = generate_settlement_data(N)
X_train2, X_test2, y_train2, y_test2 = train_test_split(
    X_sett, y_sett, test_size=0.2, random_state=42
)

settlement_scaler = StandardScaler()
X_train2_scaled = settlement_scaler.fit_transform(X_train2)
X_test2_scaled = settlement_scaler.transform(X_test2)

settlement_model = GradientBoostingClassifier(
    n_estimators=100,
    max_depth=4,
    learning_rate=0.1,
    random_state=42
)
settlement_model.fit(X_train2_scaled, y_train2)

y_pred2 = settlement_model.predict(X_test2_scaled)
print(classification_report(y_test2, y_pred2,
      target_names=["full", "partial", "rejected"]))

joblib.dump(settlement_model, "models/settlement_model.pkl")
joblib.dump(settlement_scaler, "models/settlement_scaler.pkl")
print("Saved: settlement_model.pkl + settlement_scaler.pkl")

print("\n" + "=" * 50)
print("ALL MODELS TRAINED SUCCESSFULLY")
print("Files in backend/models/")
print("=" * 50)