"""
backend/app/main.py
FastAPI main application
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.db.database import init_db
from app.api import auth, claims, policies, chatbot, admin

app = FastAPI(title="Insurance Platform API")

# CORS — allow all origins for local dev and Render
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup — initialize database tables
@app.on_event("startup")
async def startup():
    init_db()
    print("[Startup] Database initialized")

# Routers
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(claims.router, prefix="/claims", tags=["Claims"])
app.include_router(policies.router, prefix="/policies", tags=["Policies"])
app.include_router(chatbot.router, prefix="/chat", tags=["Chatbot"])
app.include_router(admin.router, prefix="/admin", tags=["Admin"])

# Health check
@app.get("/")
async def root():
    return {"status": "ok", "message": "InsureBot API is running"}
