"""
backend/app/api/auth.py
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.db.database import get_db
from app.auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter()


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    country: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/register")
async def register(req: RegisterRequest):
    db = get_db()
    cur = db.cursor()

    cur.execute("SELECT id FROM users WHERE email = %s", (req.email,))
    if cur.fetchone():
        db.close()
        raise HTTPException(status_code=400, detail="Email already registered")

    pw_hash = hash_password(req.password)
    cur.execute(
        "INSERT INTO users (name, email, password_hash, country) VALUES (%s, %s, %s, %s) RETURNING id",
        (req.name, req.email, pw_hash, req.country)
    )
    user_id = cur.fetchone()["id"]
    db.commit()
    db.close()

    token = create_access_token({
        "sub": str(user_id),
        "email": req.email,
        "name": req.name,
        "role": "user"
    })
    return {
        "token": token,
        "user": {
            "id": user_id,
            "name": req.name,
            "email": req.email,
            "role": "user"
        }
    }


@router.post("/login")
async def login(req: LoginRequest):
    db = get_db()
    cur = db.cursor()

    cur.execute("SELECT * FROM users WHERE email = %s", (req.email,))
    row = cur.fetchone()
    db.close()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = dict(row)
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({
        "sub": str(user["id"]),
        "email": user["email"],
        "name": user["name"],
        "role": user["role"]
    })
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"]
        }
    }


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return user