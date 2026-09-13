"""
backend/app/ai/chatbot.py
Insurance chatbot using Groq API (openai/gpt-oss-20b)
"""

import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

SYSTEM_PROMPT = """You are InsureBot, an AI assistant for an Indian insurance claims platform.

You help users with:
- Understanding their insurance policies (health, car, house, business)
- Guidance on filing claims in India
- IRDAI (Insurance Regulatory and Development Authority of India) regulations
- Documents required for different claim types
- Understanding policy terms and exclusions
- Settlement processes and timelines
- Tips to avoid claim rejection

Always:
- Use Indian context (₹ for currency, Indian regulations, IRDAI rules)
- Be concise and helpful
- If asked about specific policy details you don't have, ask the user to upload their policy document
- Never give legal or financial advice — recommend consulting a professional for complex cases
- Be empathetic when users are dealing with damage or loss

Keep responses under 300 words unless the user asks for detailed explanation."""


def chat(messages: list) -> str:
    """
    Send messages to Groq and get chatbot response.
    messages: list of {role: user/assistant, content: str}
    Returns: response string
    """

    if not GROQ_API_KEY:
        return _fallback_response(messages)

    try:
        from groq import Groq

        client = Groq(api_key=GROQ_API_KEY)

        # Build full message list with system prompt
        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=full_messages,
            max_tokens=600,
            temperature=0.7
        )

        return response.choices[0].message.content

    except Exception as e:
        print(f"[Chatbot Error] {e}")
        return _fallback_response(messages)


def _fallback_response(messages: list) -> str:
    last = messages[-1]["content"].lower() if messages else ""

    if any(word in last for word in ["hello", "hi", "hey"]):
        return "Hello! I'm InsureBot, your insurance assistant. How can I help you today?"
    if "claim" in last:
        return "To file a claim, you'll need your policy number, incident details, photos of damage, and relevant documents like FIR copy or medical bills. Would you like guidance for a specific claim type?"
    if "document" in last:
        return "Common documents required: Policy document, Photo ID, Incident report/FIR, Photos of damage, Repair estimates. The exact list depends on your claim type."
    if "reject" in last:
        return "Claims are commonly rejected due to: policy lapse, delayed reporting, incomplete documents, pre-existing conditions (health), or driving violations (car). Would you like tips to avoid rejection?"

    return "I'm here to help with your insurance questions. You can ask me about filing claims, required documents, policy coverage, or IRDAI regulations."
