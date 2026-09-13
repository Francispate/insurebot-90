"""
backend/app/api/chatbot.py
Chatbot API routes
"""

import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.auth import get_current_user
from app.db.database import get_db
from app.ai.chatbot import chat

router = APIRouter()


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]
    session_id: Optional[str] = None


@router.post("/message")
async def send_message(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Send a chat message and get bot response — auth required.
    Saves both user message and bot response to chat_history.
    """
    try:
        session_id = request.session_id or str(uuid.uuid4())

        # Convert messages to plain dicts for chatbot
        messages = [{"role": m.role, "content": m.content} for m in request.messages]

        # Get bot response
        bot_response = chat(messages)

        # Save to database
        db = get_db()
        now = datetime.utcnow().isoformat()

        # Save last user message
        if messages:
            last_user_msg = messages[-1]
            db.execute("""
                INSERT INTO chat_history (user_id, session_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (
                current_user["id"],
                session_id,
                last_user_msg["role"],
                last_user_msg["content"],
                now
            ))

        # Save bot response
        db.execute("""
            INSERT INTO chat_history (user_id, session_id, role, content, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            current_user["id"],
            session_id,
            "assistant",
            bot_response,
            now
        ))

        db.commit()
        db.close()

        return {
            "success": True,
            "response": bot_response,
            "session_id": session_id
        }

    except Exception as e:
        print(f"[Chatbot Route Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_chat_history(
    session_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get chat history for the current user — auth required."""
    try:
        db = get_db()

        if session_id:
            history = db.execute("""
                SELECT * FROM chat_history
                WHERE user_id = ? AND session_id = ?
                ORDER BY created_at ASC
                LIMIT 50
            """, (current_user["id"], session_id)).fetchall()
        else:
            history = db.execute("""
                SELECT * FROM chat_history
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            """, (current_user["id"],)).fetchall()

        db.close()

        return {"success": True, "history": [dict(h) for h in history]}

    except Exception as e:
        print(f"[Chat History Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))
