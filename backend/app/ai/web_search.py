"""
backend/app/ai/web_search.py
Insurance-specific web search using Tavily API
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
TAVILY_URL = "https://api.tavily.com/search"


def search_insurance_info(query: str) -> str:
    """
    Search for India-specific insurance information using Tavily.
    Returns combined answer + top 3 sources (max 3000 chars).
    """

    if not TAVILY_API_KEY:
        return _fallback_response(query)

    try:
        # Add India insurance context to query
        enhanced_query = f"{query} India insurance IRDAI"

        payload = {
            "api_key": TAVILY_API_KEY,
            "query": enhanced_query,
            "search_depth": "basic",
            "include_answer": True,
            "include_sources": True,
            "max_results": 3,
            "include_domains": [
                "irdai.gov.in",
                "policybazaar.com",
                "coverfox.com",
                "insurancedekho.com",
                "livemint.com",
                "economictimes.indiatimes.com"
            ]
        }

        response = requests.post(TAVILY_URL, json=payload, timeout=10)
        data = response.json()

        result_parts = []

        # Add AI-generated answer if available
        if data.get("answer"):
            result_parts.append(f"**Summary:**\n{data['answer']}\n")

        # Add top sources
        sources = data.get("results", [])[:3]
        if sources:
            result_parts.append("**Sources:**")
            for i, source in enumerate(sources, 1):
                title = source.get("title", "Source")
                url = source.get("url", "")
                content = source.get("content", "")[:300]
                result_parts.append(f"{i}. **{title}**\n{content}\n[Read more]({url})\n")

        combined = "\n".join(result_parts)
        return combined[:3000] if combined else _fallback_response(query)

    except Exception as e:
        print(f"[Web Search Error] {e}")
        return _fallback_response(query)


def _fallback_response(query: str) -> str:
    return f"""Web search is currently unavailable. Here's general guidance for: "{query}"

For accurate and up-to-date insurance information in India, please visit:
- **IRDAI Official**: irdai.gov.in
- **PolicyBazaar**: policybazaar.com
- **InsuranceDekho**: insurancedekho.com

You can also ask InsureBot directly for guidance on common insurance questions."""
