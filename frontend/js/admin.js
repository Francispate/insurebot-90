/* ============================================================
   InsureBot — admin.js
   Admin panel: stats cards, claims table (with inline status
   update), users table (with role update), and two charts.

   Depends on:
     api.js     — window.API, window.toast
     auth.js    — window.AuthUI (route guard via data-requires-admin)
     charts.js  — window.InsureBotCharts

   Markup hooks (admin.html):

   ── Stat cards ──
     <span id="admin-stat-users"></span>
     <span id="admin-stat-claims"></span>
     <span id="admin-stat-pending"></span>
     <span id="admin-stat-high-risk"></span>

   ── Charts ──
     <div class="chart-canvas-wrap"><canvas id="chart-claims-type"></canvas></div>
     <div class="chart-canvas-wrap"><canvas id="chart-fraud-dist"></canvas></div>

   ── Tables ──
     <div id="admin-claims-table"></div>
     <div id="admin-users-table"></div>
   ============================================================ */

(function () {
  "use strict";

  // Held so they can be destroyed/re-created on refresh
  let claimsTypeChart = null;
  let fraudDistChart  = null;

  // ─────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "—";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch { return iso; }
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
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

  function fraudBadgeClass(label) {
    if (!label) return "genuine";
    const l = label.toLowerCase();
    if (l.includes("fraud"))                              return "fraud";
    if (l.includes("suspicious") || l.includes("suspect")) return "suspicious";
    return "genuine";
  }

  function riskClass(score) {
    if (score >= 70) return "high";
    if (score >= 40) return "medium";
    return "low";
  }

  function skeleton(height = 120) {
    return `<div class="skeleton" style="height:${height}px;border-radius:8px"></div>`;
  }

  // ─────────────────────────────────────────
  // 1. Stats
  // ─────────────────────────────────────────

  async function loadStats() {
    try {
      const res = await API.admin.stats();

      setText("admin-stat-users",    res.total_users    ?? 0);
      setText("admin-stat-claims",   res.total_claims   ?? 0);
      setText("admin-stat-pending",  res.pending        ?? 0);
      setText("admin-stat-high-risk",res.high_risk      ?? 0);

      renderClaimsTypeChart(res.claims_by_type   || {});
      renderFraudDistChart( res.fraud_distribution || {});

    } catch (err) {
      toast(err.message || "Failed to load admin stats.", "error");
    }
  }

  // ─────────────────────────────────────────
  // 2. Charts
  // ─────────────────────────────────────────

  function renderClaimsTypeChart(claimsByType) {
    const canvas = document.getElementById("chart-claims-type");
    if (!canvas || !window.InsureBotCharts || !window.Chart) return;

    const labels = Object.keys(claimsByType).map(capitalize);
    const data   = Object.values(claimsByType).map(Number);

    if (claimsTypeChart) claimsTypeChart.destroy();
    claimsTypeChart = InsureBotCharts.bar(
      canvas.getContext("2d"),
      labels,
      data,
      { label: "Claims" }
    );
  }

  function renderFraudDistChart(fraudDist) {
    const canvas = document.getElementById("chart-fraud-dist");
    if (!canvas || !window.InsureBotCharts || !window.Chart) return;

    const labels = Object.keys(fraudDist).map(capitalize);
    const data   = Object.values(fraudDist).map(Number);

    if (fraudDistChart) fraudDistChart.destroy();
    fraudDistChart = InsureBotCharts.doughnut(
      canvas.getContext("2d"),
      labels,
      data
    );
  }

  // ─────────────────────────────────────────
  // 3. Claims Table
  // ─────────────────────────────────────────

  async function loadAllClaims() {
    const container = document.getElementById("admin-claims-table");
    if (!container) return;

    container.innerHTML = skeleton(160);

    try {
      const res    = await API.claims.all();
      const claims = res?.claims || [];

      if (!claims.length) {
        container.innerHTML = `<div class="alert-info">No claims in the system yet.</div>`;
        return;
      }

      container.innerHTML = buildClaimsTable(claims);
      attachStatusHandlers(container);

    } catch (err) {
      container.innerHTML = `<div class="alert-danger">Failed to load claims: ${err.message}</div>`;
    }
  }

  function buildClaimsTable(claims) {
    const rows = claims.map((c) => `
      <tr>
        <td>#${c.id}</td>
        <td>${c.user_name  || "—"}</td>
        <td class="muted small">${c.user_email || "—"}</td>
        <td>${capitalize(c.claim_type)}</td>
        <td>${capitalize(c.damage_severity)}</td>
        <td>${c.amount_estimated || "—"}</td>
        <td>
          <span class="badge badge-${fraudBadgeClass(c.fraud_label)}">
            ${c.fraud_label || "Genuine"}
          </span>
        </td>
        <td>
          <div class="risk-bar" style="width:72px">
            <div class="risk-bar-fill ${riskClass(c.fraud_risk_score || 0)}"
                 style="width:${Math.min(c.fraud_risk_score || 0, 100)}%"></div>
          </div>
          <small class="muted">${Math.round(c.fraud_risk_score || 0)}/100</small>
        </td>
        <td>
          <select class="status-select inline-select" data-claim-id="${c.id}">
            ${["pending","approved","rejected","investigating"].map((s) =>
              `<option value="${s}" ${c.status === s ? "selected" : ""}>${capitalize(s)}</option>`
            ).join("")}
          </select>
        </td>
        <td class="muted small">${fmtDate(c.created_at)}</td>
      </tr>
    `).join("");

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>User</th>
              <th>Email</th>
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

  function attachStatusHandlers(container) {
    container.querySelectorAll(".status-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const claimId = sel.dataset.claimId;
        const status  = sel.value;
        sel.disabled  = true;

        try {
          await API.claims.updateStatus(claimId, status);
          toast(`Claim #${claimId} → ${capitalize(status)}.`, "success", 2500);
        } catch (err) {
          toast(err.message || "Status update failed.", "error");
        } finally {
          sel.disabled = false;
        }
      });
    });
  }

  // ─────────────────────────────────────────
  // 4. Users Table
  // ─────────────────────────────────────────

  async function loadUsers() {
    const container = document.getElementById("admin-users-table");
    if (!container) return;

    container.innerHTML = skeleton(120);

    try {
      const res   = await API.admin.users();
      const users = res?.users || [];

      if (!users.length) {
        container.innerHTML = `<div class="alert-info">No users found.</div>`;
        return;
      }

      container.innerHTML = buildUsersTable(users);
      attachRoleHandlers(container);

    } catch (err) {
      container.innerHTML = `<div class="alert-danger">Failed to load users: ${err.message}</div>`;
    }
  }

  function buildUsersTable(users) {
    const currentUser = API.getUser();

    const rows = users.map((u) => {
      const isSelf = currentUser && String(currentUser.id) === String(u.id);
      return `
        <tr${isSelf ? ' class="row-self"' : ""}>
          <td>#${u.id}</td>
          <td>${u.name || "—"}${isSelf ? ' <span class="badge badge-pending" style="font-size:10px">You</span>' : ""}</td>
          <td class="muted small">${u.email || "—"}</td>
          <td>${u.country || "—"}</td>
          <td>
            <select class="role-select inline-select" data-user-id="${u.id}" ${isSelf ? "disabled title='Cannot change your own role'" : ""}>
              <option value="user"  ${u.role === "user"  ? "selected" : ""}>User</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
            </select>
          </td>
          <td class="muted small">${fmtDate(u.created_at)}</td>
        </tr>`;
    }).join("");

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Email</th>
              <th>Country</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function attachRoleHandlers(container) {
    container.querySelectorAll(".role-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const userId = sel.dataset.userId;
        const role   = sel.value;
        sel.disabled = true;

        try {
          await API.admin.updateUserRole(userId, role);
          toast(`User #${userId} role set to ${capitalize(role)}.`, "success", 2500);
        } catch (err) {
          toast(err.message || "Role update failed.", "error");
          // Revert select visually
          sel.value = sel.value === "admin" ? "user" : "admin";
        } finally {
          sel.disabled = false;
        }
      });
    });
  }

  // ─────────────────────────────────────────
  // 5. Refresh controls (optional buttons)
  // ─────────────────────────────────────────

  function initRefreshButtons() {
    document.getElementById("admin-refresh-claims")?.addEventListener("click", loadAllClaims);
    document.getElementById("admin-refresh-users")?.addEventListener("click",  loadUsers);
    document.getElementById("admin-refresh-stats")?.addEventListener("click",  loadStats);
  }

  // ─────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    if (!API.isLoggedIn() || !API.isAdmin()) {
      // auth.js route guard handles redirect — but we guard here too
      // to avoid API calls from non-admins.
      return;
    }

    loadStats();
    loadAllClaims();
    loadUsers();
    initRefreshButtons();
  });

  window.AdminUI = {
    loadStats,
    loadAllClaims,
    loadUsers,
  };
})();