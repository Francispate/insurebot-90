"""
backend/app/ai/advisor.py
Pre-claim advisor using Groq API (openai/gpt-oss-20b)
"""

import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


def get_preclaim_advice(claim_type: str, description: str, policy_details: str = "") -> str:
    """
    Provide pre-claim advice before the user officially submits a claim.
    Returns advice as a formatted string.
    """

    if not GROQ_API_KEY:
        return _fallback_advice(claim_type)

    try:
        from groq import Groq

        client = Groq(api_key=GROQ_API_KEY)

        policy_section = f"\nPolicy Details Provided:\n{policy_details}" if policy_details else ""

        prompt = f"""You are an expert Indian insurance pre-claim advisor.

A user wants to file a {claim_type} insurance claim with this description:
"{description}"{policy_section}

Provide structured pre-claim advice covering:

1. Is this claimable? — Based on typical {claim_type} insurance policies in India, is this likely covered?

2. Documents Required — List the specific documents needed for this {claim_type} claim in India

3. Rejection Risks — What could cause this claim to be rejected?

4. Tips to Maximize Settlement — Practical advice to get the best settlement

5. IRDAI Guidelines — Any relevant IRDAI regulations the user should know

Formatting rules (follow exactly):
- Use the numbered section headings above, each on its own line (e.g. "1. Is this claimable?").
- Under each section, use plain "- " bullet points, one per line. Do NOT use markdown tables (no "|" characters).
- Do NOT use HTML tags of any kind (no <br>, no <table>, etc). Use plain newlines only.
- Bold only the section headings and key terms with **double asterisks**, nothing else needs bolding.
- Keep the whole response under 400 words and make sure you finish the last section completely — do not cut off mid-sentence."""

        response = client.chat.completions.create(
                model="openai/gpt-oss-20b",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1100,
            temperature=0.4
        )

        return response.choices[0].message.content

    except Exception as e:
        print(f"[Advisor Error] {e}")
        return _fallback_advice(claim_type)


def _fallback_advice(claim_type: str) -> str:
    advice = {
        "car": """**Pre-Claim Advice for Car Insurance**

**Is this claimable?** Most accidental damage, theft, and third-party damage is covered under comprehensive car insurance.

**Documents Required:**
- Copy of FIR (for theft or major accidents)
- RC Book (Registration Certificate)
- Driving License
- Insurance Policy Document
- Repair estimate from authorized garage
- Photos of damage

**Rejection Risks:**
- Driving without valid license
- Driving under influence of alcohol/drugs
- Using personal vehicle for commercial purpose
- Policy lapse at time of incident
- Delayed claim filing (report within 24-48 hours)

**Tips:**
- File FIR immediately for accidents/theft
- Don't repair vehicle before surveyor inspection
- Get estimate from network garage for cashless claim

**IRDAI Guideline:** Claims must be reported within 7 days of incident.""",

        "health": """**Pre-Claim Advice for Health Insurance**

**Is this claimable?** Hospitalization for illness or injury is generally covered after the waiting period.

**Documents Required:**
- Hospital bills and discharge summary
- Doctor's prescription and reports
- Diagnostic test reports
- Policy document
- Photo ID proof

**Rejection Risks:**
- Pre-existing disease during waiting period
- Non-network hospital (for cashless)
- Treatment not covered in policy
- Incomplete documentation

**Tips:**
- Inform insurer within 24 hours of hospitalization
- Use network hospitals for cashless treatment
- Keep all original bills and reports

**IRDAI Guideline:** Insurers must settle claims within 30 days of receiving all documents.""",

        "house": """**Pre-Claim Advice for Home Insurance**

**Is this claimable?** Fire, natural disasters, burglary, and structural damage are typically covered.

**Documents Required:**
- FIR copy (for burglary/theft)
- Photos of damage
- Repair estimates
- Property ownership documents
- Policy document

**Rejection Risks:**
- Wilful negligence or intentional damage
- Damage due to wear and tear
- Unoccupied property for extended period
- Delay in reporting

**Tips:**
- Document all damage with photos before repairs
- Report to police and insurer immediately
- Get multiple repair estimates

**IRDAI Guideline:** Report claim within 15 days of incident for home insurance.""",

        "business": """**Pre-Claim Advice for Business Insurance**

**Is this claimable?** Property damage, business interruption, and liability claims are typically covered.

**Documents Required:**
- Detailed loss assessment report
- Financial records showing business impact
- Police report if applicable
- Photos of damage
- Policy document and schedule

**Rejection Risks:**
- Exclusions in policy for specific perils
- Underinsurance (insured amount less than actual value)
- Incomplete financial records
- Pre-existing damage

**Tips:**
- Engage a licensed surveyor for assessment
- Maintain proper financial records
- Document all business losses during interruption

**IRDAI Guideline:** Business claims are complex — consider hiring a licensed insurance surveyor."""
    }

    return advice.get(claim_type, advice["car"])