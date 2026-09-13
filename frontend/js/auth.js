/* ============================================================
   InsureBot — auth.js
   Login / register form handling, route guards, navbar user
   display. Depends on api.js (window.API, window.toast).

   Expected markup hooks (adjust selectors to match your HTML):

   Login form:
     <form id="login-form">
       <input name="email" type="email" required>
       <input name="password" type="password" required>
       <button type="submit" id="login-submit">Log in</button>
     </form>

   Register form:
     <form id="register-form">
       <input name="name" required>
       <input name="email" type="email" required>
       <input name="password" type="password" required>
       <input name="country">
       <button type="submit" id="register-submit">Create account</button>
     </form>

   Navbar (any page):
     <div class="navbar-user" data-auth-user hidden>
       <div class="navbar-avatar" data-auth-initial></div>
       <span data-auth-name></span>
     </div>
     <a class="navbar-link" data-auth-logout hidden>Log out</a>
     <a class="navbar-link" href="/login.html" data-auth-guest>Log in</a>
   ============================================================ */

(function () {
  "use strict";

  function setLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> ${loadingText || "Please wait..."}`;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function getInitials(name) {
    if (!name) return "?";
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase() || "")
      .join("");
  }

  function redirectAfterAuth() {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    window.location.href = redirect && redirect !== "/login.html" ? redirect : "/dashboard.html";
  }

  // ---------- Login ----------
  function initLoginForm() {
    const form = document.getElementById("login-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("login-submit") || form.querySelector('button[type="submit"]');
      const email = form.email?.value?.trim();
      const password = form.password?.value;

      if (!email || !password) {
        toast("Please enter your email and password.", "warning");
        return;
      }

      setLoading(submitBtn, true, "Logging in...");
      try {
        const res = await API.auth.login({ email, password });
        API.setToken(res.token);
        API.setUser(res.user);
        toast(`Welcome back, ${res.user.name}!`, "success", 2000);
        redirectAfterAuth();
      } catch (err) {
        toast(err.message || "Login failed. Check your credentials.", "error");
      } finally {
        setLoading(submitBtn, false);
      }
    });
  }

  // ---------- Register ----------
  function initRegisterForm() {
    const form = document.getElementById("register-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("register-submit") || form.querySelector('button[type="submit"]');
      const name = form.name?.value?.trim();
      const email = form.email?.value?.trim();
      const password = form.password?.value;
      const country = form.country?.value?.trim() || "";

      if (!name || !email || !password) {
        toast("Name, email, and password are required.", "warning");
        return;
      }
      if (password.length < 6) {
        toast("Password should be at least 6 characters.", "warning");
        return;
      }

      setLoading(submitBtn, true, "Creating account...");
      try {
        const res = await API.auth.register({ name, email, password, country });
        API.setToken(res.token);
        API.setUser(res.user);
        toast(`Welcome to InsureBot, ${res.user.name}!`, "success", 2000);
        redirectAfterAuth();
      } catch (err) {
        toast(err.message || "Registration failed.", "error");
      } finally {
        setLoading(submitBtn, false);
      }
    });
  }

  // ---------- Navbar user display ----------
  function renderNavbarUser() {
    const userEl = document.querySelector("[data-auth-user]");
    const initialEl = document.querySelector("[data-auth-initial]");
    const nameEl = document.querySelector("[data-auth-name]");
    const logoutEl = document.querySelector("[data-auth-logout]");
    const guestEl = document.querySelector("[data-auth-guest]");

    const user = API.getUser();

    if (user && API.isLoggedIn()) {
      if (userEl) userEl.hidden = false;
      if (initialEl) initialEl.textContent = getInitials(user.name);
      if (nameEl) nameEl.textContent = user.name;
      if (logoutEl) logoutEl.hidden = false;
      if (guestEl) guestEl.hidden = true;

      // Show/hide admin-only nav links
      document.querySelectorAll("[data-admin-only]").forEach((el) => {
        el.hidden = user.role !== "admin";
      });
    } else {
      if (userEl) userEl.hidden = true;
      if (logoutEl) logoutEl.hidden = true;
      if (guestEl) guestEl.hidden = false;
      document.querySelectorAll("[data-admin-only]").forEach((el) => {
        el.hidden = true;
      });
    }

    if (logoutEl) {
      logoutEl.addEventListener("click", (e) => {
        e.preventDefault();
        API.logout();
      });
    }
  }

  // ---------- Route guards ----------
  // Add data-requires-auth to <body> on protected pages,
  // and data-requires-admin on admin-only pages.
  function enforceRouteGuards() {
    const body = document.body;
    if (!body) return;

    const requiresAuth = body.hasAttribute("data-requires-auth");
    const requiresAdmin = body.hasAttribute("data-requires-admin");

    if ((requiresAuth || requiresAdmin) && !API.isLoggedIn()) {
      const returnTo = encodeURIComponent(window.location.pathname);
      window.location.href = `/login.html?redirect=${returnTo}`;
      return;
    }

    if (requiresAdmin && !API.isAdmin()) {
      toast("Admin access required.", "error");
      window.location.href = "/dashboard.html";
    }
  }

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    enforceRouteGuards();
    initLoginForm();
    initRegisterForm();
    renderNavbarUser();
  });

  // Expose for other scripts that may want to re-render after profile changes
  window.AuthUI = { renderNavbarUser, enforceRouteGuards };
})();