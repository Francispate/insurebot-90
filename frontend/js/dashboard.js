/* ============================================================
   InsureBot — dashboard.js
   Handles the logged-in user's dashboard:
     1. Time-of-day greeting with user's first name
     2. Quick search bar → redirects to claim.html?q=
     3. Recent claims list (last 3)
     4. My policies summary (last 3)
     5. Quick-action stat counters

   Depends on api.js (window.API, window.toast) and
   auth.js (window.AuthUI). ClaimsUI from claims.js is
   used if available (for badge/risk helpers).

   Markup hooks (dashboard.html):

     <span id="dash-greeting"></span>
     <span id="dash-user-name"></span>

     <form id="dash-search-form">
       <input id="dash-search-input" type="search" placeholder="Search claims…">
       <button type="submit">Search</button>
     </form>

     <!-- Stat pills (optional) -->
     <span id="dash-stat-total"></span>
     <span id="dash-stat-pending"></span>
     <span id="dash-stat-approved"></span>

     <!-- Recent claims card -->
     <div id="dash-recent-claims"></div>

     <!-- My policies card -->
     <div id="dash-recent-policies"></div>
   ============================================================ */

(function () {
  "use strict";

  // ─────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "";
  }

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  function statusBadgeClass(status) {
    const map = {
      pending:       "badge-pending",
      approved:      "badge-approved",
      rejected:      "badge-rejected",
      investigating: "badge-investigating",
    };
    return map[(status || "").toLowerCase()] || "badge-pending";
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
  }

  // ─────────────────────────────────────────
  // 1. Greeting
  // ─────────────────────────────────────────

  function renderGreeting() {
    const user = API.getUser();
    const firstName = user?.name ? user.name.trim().split(/\s+/)[0] : "there";

    setText("dash-greeting",   getGreeting() + ",");
    setText("dash-user-name",  firstName + "!");
  }

  // ─────────────────────────────────────────
  // 2. Search bar
  // ─────────────────────────────────────────

  function initSearch() {
    const form = document.getElementById("dash-search-form");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const query = document.getElementById("dash-search-input")?.value?.trim();
      if (query) {
        window.location.href = `/claim.html?q=${encodeURIComponent(query)}`;
      }
    });
  }

  // ─────────────────────────────────────────
  // 3. Recent Claims
  // ─────────────────────────────────────────

  async function loadRecentClaims() {
    const container = document.getElementById("dash-recent-claims");
    if (!container) return;

    container.innerHTML = `<div class="skeleton" style="height:80px;border-radius:8px"></div>`;

    try {
      const res    = await API.claims.mine();
      const claims = (res?.claims || []).slice(0, 3);

      // Populate stat counters while we have the full list
      const all     = res?.claims || [];
      const pending  = all.filter((c) => c.status === "pending").length;
      const approved = all.filter((c) => c.status === "approved").length;
      setText("dash-stat-total",    all.length);
      setText("dash-stat-pending",  pending);
      setText("dash-stat-approved", approved);

      if (!claims.length) {
        container.innerHTML = `
          <div class="alert-info">
            No claims yet.
            <a href="/claim.html" class="alert-link">Submit your first claim →</a>
          </div>`;
        return;
      }

      container.innerHTML = claims.map((c) => `
        <div class="dash-claim-row">
          <div class="dash-claim-meta">
            <span class="dash-claim-type">${capitalize(c.claim_type)}</span>
            <span class="dash-claim-id muted">#${c.id}</span>
          </div>
          <div class="dash-claim-info">
            <span class="dash-claim-amount">${c.amount_estimated || "—"}</span>
            <span class="badge ${statusBadgeClass(c.status)}">${capitalize(c.status)}</span>
          </div>
          <div class="dash-claim-date muted">${fmtDate(c.created_at)}</div>
        </div>
      `).join("");

    } catch (err) {
      container.innerHTML = `<div class="alert-danger">Could not load claims: ${err.message}</div>`;
    }
  }

  // ─────────────────────────────────────────
  // 4. Recent Policies
  // ─────────────────────────────────────────

  async function loadRecentPolicies() {
    const container = document.getElementById("dash-recent-policies");
    if (!container) return;

    container.innerHTML = `<div class="skeleton" style="height:60px;border-radius:8px"></div>`;

    try {
      const res      = await API.policies.mine();
      const policies = (res?.policies || []).slice(0, 3);

      if (!policies.length) {
        container.innerHTML = `
          <div class="alert-info">
            No policies analyzed yet.
            <a href="/policy.html" class="alert-link">Analyze a policy →</a>
          </div>`;
        return;
      }

      container.innerHTML = policies.map((p) => `
        <div class="dash-policy-row">
          <div class="dash-policy-name">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" width="14" height="14"
                 style="margin-right:6px;vertical-align:middle;opacity:.7">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            ${p.filename || "Pasted text"}
          </div>
          <div class="dash-policy-summary muted">${p.summary ? truncate(p.summary, 80) : "No summary"}</div>
          <div class="dash-policy-date muted">${fmtDate(p.uploaded_at)}</div>
        </div>
      `).join("");

    } catch (err) {
      container.innerHTML = `<div class="alert-danger">Could not load policies: ${err.message}</div>`;
    }
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max) + "…";
  }

  // ─────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    // Auth guard — auth.js handles redirect if not logged in via
    // data-requires-auth on <body>, but we still guard here in case.
    if (!API.isLoggedIn()) return;

    renderGreeting();
    initSearch();
    loadRecentClaims();
    loadRecentPolicies();
  });

  window.DashboardUI = {
    loadRecentClaims,
    loadRecentPolicies,
    renderGreeting,
  };
})();