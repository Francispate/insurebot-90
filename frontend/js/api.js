/* ============================================================
   InsureBot — api.js
   Central API client: base URL, token storage, fetch wrapper,
   global 401 handling, toast notifications.
   Every other JS file should call through window.API.
   ============================================================ */

(function () {
  "use strict";

  // ---------- Config ----------
  // Uses window.INSUREBOT_API_BASE if set on the page, otherwise
  // auto-picks localhost for local dev or the live Render URL for
  // anywhere else (e.g. your Netlify domain).
  const BASE_URL =
    window.INSUREBOT_API_BASE ||
    (location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://localhost:8000"
      : "https://insurebot-90.onrender.com");

  const TOKEN_KEY = "insurebot_token";
  const USER_KEY = "insurebot_user";

  // ---------- Token / User storage ----------
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getUser() {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setUser(user) {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function isAdmin() {
    const u = getUser();
    return !!u && u.role === "admin";
  }

  // ---------- 401 handling ----------
  function handleUnauthorized() {
    clearToken();
    // Avoid redirect loop if already on login page
    if (!window.location.pathname.includes("login")) {
      const returnTo = encodeURIComponent(window.location.pathname);
      window.location.href = `/login.html?redirect=${returnTo}`;
    }
  }

  // ---------- Core request ----------
  /**
   * @param {string} path - e.g. "/claims/" (leading slash required)
   * @param {object} options
   *   method: "GET" | "POST" | "PUT" | "DELETE" (default GET)
   *   body: object | FormData | URLSearchParams (auto-detected)
   *   auth: boolean (default true) — attach Bearer token
   *   isForm: boolean — force application/x-www-form-urlencoded encoding
   *            for plain objects (used by endpoints expecting Form(...))
   *   query: object — appended as ?key=value pairs
   */
  async function request(path, options = {}) {
    const {
      method = "GET",
      body = null,
      auth = true,
      isForm = false,
      query = null,
    } = options;

    let url = BASE_URL + path;

    if (query && Object.keys(query).length) {
      const qs = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null) qs.append(k, v);
      });
      const qsStr = qs.toString();
      if (qsStr) url += (url.includes("?") ? "&" : "?") + qsStr;
    }

    const headers = {};
    const token = getToken();
    if (auth && token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let fetchBody;

    if (body instanceof FormData) {
      // Let the browser set the multipart boundary itself
      fetchBody = body;
    } else if (isForm && body && typeof body === "object") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      Object.entries(body).forEach(([k, v]) => params.append(k, v));
      fetchBody = params;
    } else if (body !== null && body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: fetchBody,
      });
    } catch (networkErr) {
      const err = new Error("Network error — could not reach the server.");
      err.isNetworkError = true;
      err.original = networkErr;
      throw err;
    }

    if (res.status === 401) {
      handleUnauthorized();
      const err = new Error("Not authenticated");
      err.status = 401;
      throw err;
    }

    let data = null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await res.json().catch(() => null);
    }

    if (!res.ok) {
      const message =
        (data && (data.detail || data.message)) ||
        `Request failed with status ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // ---------- Convenience methods ----------
  const API = {
    // config / state
    BASE_URL,
    getToken,
    setToken,
    clearToken,
    getUser,
    setUser,
    isLoggedIn,
    isAdmin,
    logout() {
      clearToken();
      window.location.href = "/login.html";
    },

    // generic
    request,
    get(path, opts = {}) {
      return request(path, { ...opts, method: "GET" });
    },
    post(path, body, opts = {}) {
      return request(path, { ...opts, method: "POST", body });
    },
    put(path, body, opts = {}) {
      return request(path, { ...opts, method: "PUT", body });
    },
    del(path, opts = {}) {
      return request(path, { ...opts, method: "DELETE" });
    },

    // ---- Auth ----
    auth: {
      register(payload) {
        return API.post("/auth/register", payload, { auth: false });
      },
      login(payload) {
        return API.post("/auth/login", payload, { auth: false });
      },
      me() {
        return API.get("/auth/me");
      },
    },

    // ---- Claims ----
    claims: {
      analyze(file) {
        const fd = new FormData();
        fd.append("file", file);
        return API.post("/claims/analyze", fd, { auth: false });
      },
      save(claimPayload) {
        return API.post("/claims/", claimPayload);
      },
      mine() {
        return API.get("/claims/");
      },
      all() {
        return API.get("/claims/all");
      },
      updateStatus(claimId, status) {
        return API.put(
          `/claims/${claimId}/status`,
          { status },
          { isForm: true }
        );
      },
    },

    // ---- Policies ----
    policies: {
      analyzeFile(file) {
        const fd = new FormData();
        fd.append("file", file);
        return API.post("/policies/analyze", fd);
      },
      analyzeText(policyText) {
        const fd = new FormData();
        fd.append("policy_text", policyText);
        return API.post("/policies/analyze", fd);
      },
      advice(payload) {
        return API.post("/policies/advice", payload);
      },
      mine() {
        return API.get("/policies/");
      },
    },

    // ---- Chatbot ----
    chat: {
      send(messages, sessionId) {
        return API.post("/chat/message", {
          messages,
          session_id: sessionId || null,
        });
      },
      history(sessionId) {
        return API.get("/chat/history", {
          query: sessionId ? { session_id: sessionId } : null,
        });
      },
    },

    // ---- Admin ----
    admin: {
      stats() {
        return API.get("/admin/stats");
      },
      users() {
        return API.get("/admin/users");
      },
      updateUserRole(userId, role) {
        return API.put(`/admin/users/${userId}/role`, null, {
          query: { role },
        });
      },
    },
  };

  window.API = API;

  // ---------- Toast notifications ----------
  // Matches #toast-container / .toast / .toast-success etc in theme.css
  function ensureToastContainer() {
    let el = document.getElementById("toast-container");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast-container";
      document.body.appendChild(el);
    }
    return el;
  }

  const TOAST_ICONS = {
    success: "✓",
    error: "✕",
    warning: "!",
    info: "i",
  };

  /**
   * @param {string} message
   * @param {"success"|"error"|"warning"|"info"} type
   * @param {number} duration ms before auto-dismiss (0 = sticky)
   */
  function toast(message, type = "info", duration = 4000) {
    const container = ensureToastContainer();
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
      <span class="toast-message"></span>
    `;
    el.querySelector(".toast-message").textContent = message;
    container.appendChild(el);

    const remove = () => {
      el.classList.add("toast-out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    };

    if (duration > 0) {
      setTimeout(remove, duration);
    }
    el.addEventListener("click", remove);

    return { remove };
  }

  window.toast = toast;

  /**
   * Convenience: wraps an async fn, shows an error toast on failure.
   * Returns the fn's result, or undefined on error (already toasted).
   */
  window.withErrorToast = async function withErrorToast(fn, fallbackMsg) {
    try {
      return await fn();
    } catch (err) {
      if (err && err.status === 401) return; // already handled via redirect
      toast(err.message || fallbackMsg || "Something went wrong", "error");
      return undefined;
    }
  };
})();