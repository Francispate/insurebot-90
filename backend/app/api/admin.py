"""
backend/app/api/admin.py
Admin API routes
"""

from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user
from app.db.database import get_db

router = APIRouter()


def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


@router.get("/stats")
async def get_stats(current_user: dict = Depends(require_admin)):
    """Get platform statistics — admin only."""
    try:
        db = get_db()

        total_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        total_claims = db.execute("SELECT COUNT(*) FROM claims").fetchone()[0]
        pending = db.execute(
            "SELECT COUNT(*) FROM claims WHERE status = 'pending'"
        ).fetchone()[0]
        high_risk = db.execute(
            "SELECT COUNT(*) FROM claims WHERE fraud_risk_score >= 60"
        ).fetchone()[0]

        # Claims by type
        claims_by_type_rows = db.execute("""
            SELECT claim_type, COUNT(*) as count
            FROM claims
            GROUP BY claim_type
        """).fetchall()
        claims_by_type = {row["claim_type"]: row["count"] for row in claims_by_type_rows}

        # Fraud distribution
        genuine = db.execute(
            "SELECT COUNT(*) FROM claims WHERE fraud_label = 'genuine'"
        ).fetchone()[0]
        fraud = db.execute(
            "SELECT COUNT(*) FROM claims WHERE fraud_label = 'fraud'"
        ).fetchone()[0]

        db.close()

        return {
            "success": True,
            "total_users": total_users,
            "total_claims": total_claims,
            "pending": pending,
            "high_risk": high_risk,
            "claims_by_type": claims_by_type,
            "fraud_distribution": {
                "genuine": genuine,
                "fraud": fraud
            }
        }

    except Exception as e:
        print(f"[Admin Stats Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users")
async def get_all_users(current_user: dict = Depends(require_admin)):
    """Get all users — admin only."""
    try:
        db = get_db()
        users = db.execute("""
            SELECT id, name, email, role, country, created_at
            FROM users
            ORDER BY created_at DESC
        """).fetchall()
        db.close()

        return {"success": True, "users": [dict(u) for u in users]}

    except Exception as e:
        print(f"[Admin Users Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: int,
    role: str,
    current_user: dict = Depends(require_admin)
):
    """Update a user's role — admin only."""
    valid_roles = ["user", "admin"]
    if role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {valid_roles}")

    try:
        db = get_db()
        db.execute(
            "UPDATE users SET role = ? WHERE id = ?",
            (role, user_id)
        )
        db.commit()
        db.close()

        return {"success": True, "user_id": user_id, "role": role}

    except Exception as e:
        print(f"[Update Role Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))
