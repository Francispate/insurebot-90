/* ============================================================
   InsureBot — claims.js
   Handles:
     1. Claim analyzer (image upload → analyze → preview → save)
     2. My Claims list page
     3. Admin all-claims table (status update)

   Depends on api.js (window.API, window.toast, window.withErrorToast)
   and auth.js (window.AuthUI).

   Markup hooks:

   ── Analyzer page (e.g. analyze.html) ──
     <form id="analyze-form">
       <input type="file" id="claim-file" name="file" accept="image/*" required>
       <button type="submit" id="analyze-submit">Analyze</button>
     </form>

     <!-- Shown after analyze, hidden initially -->
     <section id="analyze-results" hidden>
       <!-- Vision -->
       <div id="result-claim-type"></div>
       <div id="result-severity"></div>
       <div id="result-amount"></div>
       <!-- Fraud -->
       <div id="result-fraud-label"></div>
       <div class="risk-bar"><div id="result-risk-fill" class="risk-bar-fill"></div></div>
       <span id="result-risk-score"></span>
       <!-- Settlement -->
       <div id="result-settlement"></div>
       <div id="result-confidence"></div>
     </section>

     <!-- Save form (pre-filled from analyze, user can edit) -->
     <form id="save-claim-form" hidden>
       <input  id="sc-claim-type"    name="claim_type">
       <input  id="sc-incident-date" name="incident_date" type="date">
       <input  id="sc-location"      name="location">
       <input  id="sc-amount"        name="amount_estimated">
       <select id="sc-severity"      name="damage_severity">
         <option value="minor">Minor</option>
         <option value="moderate">Moderate</option>
         <option value="severe">Severe</option>
         <option value="total_loss">Total Loss</option>
       </select>
       <textarea id="sc-description"  name="description"></textarea>
       <input  id="sc-parts"         name="affected_parts">
       <!-- hidden fields populated from analyze result -->
       <input type="hidden" id="sc-fraud-score" name="fraud_risk_score">
       <input type="hidden" id="sc-fraud-label" name="fraud_label">
       <input type="hidden" id="sc-settlement"  name="settlement_predicted">
       <input type="hidden" id="sc-confidence"  name="settlement_confidence">
       <button type="submit" id="save-submit">Submit Claim</button>
     </form>

   ── My Claims page (e.g. my-claims.html) ──
     <div id="my-claims-container">
       <!-- rows injected here -->
     </div>

   ── Admin Claims page (e.g. admin-claims.html) ──
     <div id="admin-claims-container">
       <!-- rows injected here -->
     </div>
   ============================================================ */

(function () {
  "use strict";

  // ─────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────

  function setLoading(button, isLoading, text) {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> ${text || "Please wait…"}`;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "—";
  }

  function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
  }

  /**
   * Returns a CSS class suffix for a fraud label string.
   * Normalises common variants from the backend.
   */
  function fraudBadgeClass(label) {
    if (!label) return "genuine";
    const l = label.toLowerCase();
    if (l.includes("fraud")) return "fraud";
    if (l.includes("suspicious") || l.includes("suspect")) return "suspicious";
    return "genuine";
  }

  /**
   * Maps 0-100 fraud score to risk-bar CSS class.
   */
  function riskClass(score) {
    if (score >= 70) return "high";
    if (score >= 40) return "medium";
    return "low";
  }

  /**
   * Maps a claim status string to the CSS badge class.
   */
  function statusBadgeClass(status) {
    const map = {
      pending: "badge-pending",
      approved: "badge-approved",
      rejected: "badge-rejected",
      investigating: "badge-investigating",
    };
    return map[(status || "").toLowerCase()] || "badge-pending";
  }

  /**
   * Formats an ISO date string (or partial) to a locale-friendly date.
   */
  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  /**
   * Generic key-value renderer for opaque objects (vision, fraud, settlement).
   * Returns an HTML string of <div class="kv-row"> pairs.
   */
  function renderKVPairs(obj, skipKeys = []) {
    if (!obj || typeof obj !== "object") return "<em>No data</em>";
    return Object.entries(obj)
      .filter(([k]) => !skipKeys.includes(k))
      .map(([k, v]) => {
        const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        let valHtml;
        if (Array.isArray(v)) {
          valHtml = v.length
            ? `<ul class="kv-list">${v.map((item) => `<li>${item}</li>`).join("")}</ul>`
            : "—";
        } else if (v && typeof v === "object") {
          valHtml = JSON.stringify(v);
        } else {
          valHtml = v ?? "—";
        }
        const rowClass = Array.isArray(v) && v.length ? "kv-row kv-row-list" : "kv-row";
        return `<div class="${rowClass}"><span class="kv-label">${label}</span><span class="kv-value">${valHtml}</span></div>`;
      })
      .join("");
  }

  // ─────────────────────────────────────────
  // 1. Claim Analyzer
  // ─────────────────────────────────────────

  function initAnalyzer() {
    const form = document.getElementById("analyze-form");
    if (!form) return;

    const fileInput   = document.getElementById("claim-file");
    const submitBtn   = document.getElementById("analyze-submit");
    const resultsEl   = document.getElementById("analyze-results");
    const loadingEl   = document.getElementById("analyze-loading");
    const saveFormEl  = document.getElementById("save-claim-form");
    const saveSubmit  = document.getElementById("save-submit");

    // State persisted between analyze and save steps
    let lastAnalysis = null;

    // ── Step 1: Analyze ──
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = fileInput?.files?.[0];
      if (!file) {
        toast("Please select an image file.", "warning");
        return;
      }

      setLoading(submitBtn, true, "Analyzing…");
      if (resultsEl) resultsEl.hidden = true;
      if (saveFormEl) saveFormEl.hidden = true;
      if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      try {
        const res = await API.claims.analyze(file);

        if (!res || !res.success) {
          toast("Analysis returned an unexpected response.", "error");
          return;
        }

        lastAnalysis = res;
        renderAnalysisResults(res);

        if (resultsEl) resultsEl.hidden = false;
        if (saveFormEl) {
          prefillSaveForm(res);
          saveFormEl.hidden = false;
        }
      } catch (err) {
        toast(err.message || "Analysis failed.", "error");
      } finally {
        setLoading(submitBtn, false);
        if (loadingEl) loadingEl.hidden = true;
      }
    });

    // ── Step 2: Save ──
    if (saveFormEl) {
      saveFormEl.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!API.isLoggedIn()) {
          toast("You must be logged in to save a claim.", "warning");
          const returnTo = encodeURIComponent(window.location.pathname);
          window.location.href = `/login.html?redirect=${returnTo}`;
          return;
        }

        const claimType   = document.getElementById("sc-claim-type")?.value?.trim();
        const description = document.getElementById("sc-description")?.value?.trim();
        const incidentDate = document.getElementById("sc-incident-date")?.value;

        if (!claimType || !description || !incidentDate) {
          toast("Claim type, description, and incident date are required.", "warning");
          return;
        }

        const payload = {
          claim_type:             claimType,
          description:            description,
          incident_date:          incidentDate,
          location:               document.getElementById("sc-location")?.value?.trim() || "",
          amount_estimated:       document.getElementById("sc-amount")?.value?.trim() || "",
          damage_severity:        document.getElementById("sc-severity")?.value || "",
          affected_parts:         document.getElementById("sc-parts")?.value?.trim() || "",
          fraud_risk_score:       parseFloat(document.getElementById("sc-fraud-score")?.value) || 0,
          fraud_label:            document.getElementById("sc-fraud-label")?.value || "",
          settlement_predicted:   document.getElementById("sc-settlement")?.value || "",
          settlement_confidence:  document.getElementById("sc-confidence")?.value || "",
        };

        setLoading(saveSubmit, true, "Submitting…");
        try {
          const res = await API.claims.save(payload);
          if (res && res.success) {
            toast(`Claim #${res.claim_id} submitted successfully!`, "success", 3000);
            // Reset UI
            form.reset();
            saveFormEl.reset();
            if (resultsEl) resultsEl.hidden = true;
            saveFormEl.hidden = true;
            lastAnalysis = null;
          } else {
            toast("Claim save returned an unexpected response.", "error");
          }
        } catch (err) {
          toast(err.message || "Failed to save claim.", "error");
        } finally {
          setLoading(saveSubmit, false);
        }
      });
    }
  }

  /**
   * Populates the result display elements from the analyze API response.
   * Treats vision/fraud/settlement as opaque but extracts known fields.
   */
  function renderAnalysisResults(res) {
    const vision     = res.vision     || {};
    const fraud      = res.fraud      || {};
    const settlement = res.settlement || {};

    // ── Known vision fields ──
    setText("result-claim-type", vision.claim_type);
    setText("result-severity",   vision.damage_severity);
    setText("result-amount",     vision.estimated_amount);

    // ── Fraud ──
    const score     = parseFloat(fraud.fraud_risk_score) || 0;
    const label     = fraud.fraud_label || (score >= 70 ? "Fraud" : score >= 40 ? "Suspicious" : "Genuine");
    const cls       = fraudBadgeClass(label);
    const rc        = riskClass(score);

    const fraudLabelEl = document.getElementById("result-fraud-label");
    if (fraudLabelEl) {
      fraudLabelEl.innerHTML = `<span class="badge badge-${cls}">${label}</span>`;
    }

    const riskFill = document.getElementById("result-risk-fill");
    if (riskFill) {
      riskFill.style.width  = `${Math.min(score, 100)}%`;
      riskFill.className    = `risk-bar-fill ${rc}`;
    }
    setText("result-risk-score", `${Math.round(score)} / 100`);

    // ── Settlement ──
    const confidenceRaw = settlement.settlement_confidence ?? settlement.confidence;
    setText("result-settlement",  settlement.prediction || settlement.settlement_predicted || "—");
    setText("result-confidence",  confidenceRaw !== undefined
      ? `${Math.round(parseFloat(confidenceRaw))}%`
      : "—"
    );

    // ── Extra / opaque fields — render generically below each section ──
    const visionExtra = document.getElementById("result-vision-extra");
    if (visionExtra) {
      visionExtra.innerHTML = renderKVPairs(vision, [
        "claim_type", "damage_severity", "estimated_amount",
      ]);
    }

    const fraudExtra = document.getElementById("result-fraud-extra");
    if (fraudExtra) {
      fraudExtra.innerHTML = renderKVPairs(fraud, [
        "fraud_risk_score", "fraud_label",
      ]);
    }

    const settlementExtra = document.getElementById("result-settlement-extra");
    if (settlementExtra) {
      settlementExtra.innerHTML = renderKVPairs(settlement, [
        "prediction", "settlement_predicted", "confidence", "settlement_confidence",
      ]);
    }

    // ── "Why this score" explanations ──
    renderRiskWhy(vision, fraud, score);
    renderConfidenceWhy(vision, fraud, settlement, confidenceRaw);
  }

  /**
   * Explains the fraud risk score in plain language using the fields
   * we actually have (severity, rejection risks flagged by the vision
   * model, whether the claim was flagged for investigation).
   */
  function renderRiskWhy(vision, fraud, score) {
    const box = document.getElementById("result-risk-why");
    if (!box) return;

    const reasons = [];
    const severity = (vision.damage_severity || "").toLowerCase();

    if (severity === "severe" || severity === "total_loss") {
      reasons.push(`Damage severity is rated "${vision.damage_severity}", which carries higher scrutiny.`);
    }
    if (fraud.requires_investigation) {
      reasons.push("The claim was flagged as needing manual investigation.");
    }
    const risks = Array.isArray(vision.rejection_risks) ? vision.rejection_risks : [];

    let html = `<strong>Why ${Math.round(score)}/100?</strong> `;
    html += score >= 70
      ? "This is a high-risk score — several factors raised concern."
      : score >= 40
      ? "This is a moderate score — a few factors add some uncertainty."
      : "This is a low-risk score — the claim looks broadly consistent with a genuine submission.";

    if (reasons.length || risks.length) {
      html += `<ul>`;
      reasons.forEach((r) => (html += `<li>${r}</li>`));
      risks.forEach((r) => (html += `<li>${r}</li>`));
      html += `</ul>`;
    }

    box.innerHTML = html;
    box.hidden = false;
  }

  /**
   * Explains the settlement confidence in plain language using the
   * inputs that fed the prediction (severity, estimated amount, fraud
   * risk score).
   */
  function renderConfidenceWhy(vision, fraud, settlement, confidenceRaw) {
    const box = document.getElementById("result-confidence-why");
    if (!box) return;

    const conf = parseFloat(confidenceRaw) || 0;
    const severity = vision.damage_severity || "unknown severity";
    const fraudScore = Math.round(parseFloat(fraud.fraud_risk_score) || 0);

    let html = `<strong>Why ${Math.round(conf)}% confidence?</strong> `;
    html += `This reflects how closely this claim's profile — estimated amount `
      + `(${vision.estimated_amount || "unspecified"}), damage severity (${severity}), `
      + `and fraud risk score (${fraudScore}/100) — matches patterns seen in past settled claims. `;
    html += conf >= 75
      ? "A high confidence means this combination of factors was a strong, consistent match."
      : conf >= 50
      ? "A moderate confidence means the combination was a reasonable but not decisive match."
      : "A lower confidence means this claim's profile was less typical, so the predicted outcome is less certain.";

    box.innerHTML = html;
    box.hidden = false;
  }

  /**
   * Pre-fills the save form using the analyze result.
   */
  function prefillSaveForm(res) {
    const vision     = res.vision     || {};
    const fraud      = res.fraud      || {};
    const settlement = res.settlement || {};

    setVal("sc-claim-type", vision.claim_type || "");
    setVal("sc-severity",   vision.damage_severity || "");
    setVal("sc-amount",     vision.estimated_amount || "");

    // Today as default incident date
    const today = new Date().toISOString().split("T")[0];
    setVal("sc-incident-date", today);

    // Hidden fields
    setVal("sc-fraud-score", fraud.fraud_risk_score ?? "");
    setVal("sc-fraud-label", fraud.fraud_label || "");
    setVal("sc-settlement",  settlement.prediction || settlement.settlement_predicted || "");
    setVal("sc-confidence",  settlement.settlement_confidence ?? settlement.confidence ?? "");
  }

  // ─────────────────────────────────────────
  // 2. My Claims List
  // ─────────────────────────────────────────

  function initMyClaims() {
    const container = document.getElementById("my-claims-container");
    if (!container) return;

    loadMyClaims(container);
  }

  async function loadMyClaims(container) {
    container.innerHTML = `<div class="skeleton skeleton-table"></div>`;

    try {
      const res = await API.claims.mine();
      const claims = res?.claims || [];

      if (!claims.length) {
        container.innerHTML = `
          <div class="alert-info">
            You have no claims yet. <a href="/analyze.html">Analyze your first claim →</a>
          </div>`;
        return;
      }

      container.innerHTML = buildClaimsTable(claims, false);
    } catch (err) {
      container.innerHTML = `<div class="alert-danger">Failed to load claims: ${err.message}</div>`;
    }
  }

  // ─────────────────────────────────────────
  // 3. Admin All-Claims Table
  // ─────────────────────────────────────────

  function initAdminClaims() {
    const container = document.getElementById("admin-claims-container");
    if (!container) return;

    loadAllClaims(container);
  }

  async function loadAllClaims(container) {
    container.innerHTML = `<div class="skeleton skeleton-table"></div>`;

    try {
      const res = await API.claims.all();
      const claims = res?.claims || [];

      if (!claims.length) {
        container.innerHTML = `<div class="alert-info">No claims in the system yet.</div>`;
        return;
      }

      container.innerHTML = buildClaimsTable(claims, true);
      attachStatusHandlers(container);
    } catch (err) {
      container.innerHTML = `<div class="alert-danger">Failed to load claims: ${err.message}</div>`;
    }
  }

  /**
   * Builds an HTML table for a claims array.
   * isAdmin=true adds user columns and an inline status selector.
   */
  function buildClaimsTable(claims, isAdmin) {
    const adminCols = isAdmin
      ? `<th>User</th><th>Email</th>`
      : "";
    const adminColsData = (c) =>
      isAdmin
        ? `<td>${c.user_name || "—"}</td><td>${c.user_email || "—"}</td>`
        : "";

    const statusCell = (c) => {
      if (!isAdmin) {
        return `<td><span class="badge ${statusBadgeClass(c.status)}">${c.status || "pending"}</span></td>`;
      }
      return `
        <td>
          <select class="status-select" data-claim-id="${c.id}">
            ${["pending", "approved", "rejected", "investigating"].map((s) =>
              `<option value="${s}" ${c.status === s ? "selected" : ""}>${capitalize(s)}</option>`
            ).join("")}
          </select>
        </td>`;
    };

    const rows = claims.map((c) => `
      <tr>
        <td>#${c.id}</td>
        ${adminColsData(c)}
        <td>${c.claim_type || "—"}</td>
        <td>${c.damage_severity || "—"}</td>
        <td>${c.amount_estimated || "—"}</td>
        <td>
          <span class="badge badge-${fraudBadgeClass(c.fraud_label)}">
            ${c.fraud_label || "Genuine"}
          </span>
        </td>
        <td>
          <div class="risk-bar" style="width:80px">
            <div class="risk-bar-fill ${riskClass(c.fraud_risk_score || 0)}"
                 style="width:${Math.min(c.fraud_risk_score || 0, 100)}%"></div>
          </div>
          <small>${Math.round(c.fraud_risk_score || 0)}/100</small>
        </td>
        ${statusCell(c)}
        <td>${fmtDate(c.created_at)}</td>
      </tr>
    `).join("");

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              ${adminCols}
              <th>Type</th>
              <th>Severity</th>
              <th>Est. Amount</th>
              <th>Fraud</th>
              <th>Risk</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  /**
   * Wires change handlers on every .status-select inside container.
   * On change → PUT /claims/{id}/status (form-encoded).
   */
  function attachStatusHandlers(container) {
    container.querySelectorAll(".status-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const claimId = sel.dataset.claimId;
        const status  = sel.value;
        sel.disabled  = true;

        try {
          await API.claims.updateStatus(claimId, status);
          toast(`Claim #${claimId} marked as ${status}.`, "success", 2500);
          // Update the select's visual state
          sel.classList.remove("status-changed");
          void sel.offsetWidth; // reflow
          sel.classList.add("status-changed");
        } catch (err) {
          toast(err.message || "Failed to update status.", "error");
        } finally {
          sel.disabled = false;
        }
      });
    });
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // ─────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    initAnalyzer();
    initMyClaims();
    initAdminClaims();
  });

  // Expose for external scripts (e.g. dashboard summary widgets)
  window.ClaimsUI = {
    loadMyClaims,
    loadAllClaims,
    riskClass,
    fraudBadgeClass,
    statusBadgeClass,
    fmtDate,
  };
})();