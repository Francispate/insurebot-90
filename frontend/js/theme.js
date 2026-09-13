/* ============================================================
   InsureBot — theme.js
   Dark / light theme toggle. Reads persisted preference from
   localStorage and applies it immediately to <html> to avoid
   flash-of-wrong-theme (FOUT).

   Markup hook (any page):
     <button id="theme-toggle" aria-label="Toggle theme">
       <!-- icon swapped automatically -->
     </button>

   CSS expectation:
     :root[data-theme="light"] { ... }   (or absence = dark)
   The script toggles data-theme="light" on <html>.
   ============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY  = "insurebot_theme";
  const LIGHT_VALUE  = "light";
  const DARK_VALUE   = "dark";

  const MOON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
       width="18" height="18">
    <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>
  </svg>`;

  const SUN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
       width="18" height="18">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1"  x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22"   x2="5.64"  y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1"  y1="12" x2="3"  y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
    <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
  </svg>`;

  // ── Apply theme immediately (before DOMContentLoaded) ──
  function getPreference() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    // Respect OS preference as default
    return window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? LIGHT_VALUE
      : DARK_VALUE;
  }

  function applyTheme(theme) {
    if (theme === LIGHT_VALUE) {
      document.documentElement.setAttribute("data-theme", LIGHT_VALUE);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem(STORAGE_KEY, theme);
    updateToggleIcon(theme);
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === LIGHT_VALUE
      ? LIGHT_VALUE
      : DARK_VALUE;
  }

  function updateToggleIcon(theme) {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.innerHTML   = theme === LIGHT_VALUE ? MOON_SVG  : SUN_SVG;
    btn.title       = theme === LIGHT_VALUE ? "Switch to dark mode" : "Switch to light mode";
    btn.setAttribute("aria-label", btn.title);
  }

  // Apply immediately so there's no theme flicker
  applyTheme(getPreference());

  document.addEventListener("DOMContentLoaded", () => {
    // Re-run icon update in case the button didn't exist yet
    updateToggleIcon(currentTheme());

    const btn = document.getElementById("theme-toggle");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const next = currentTheme() === DARK_VALUE ? LIGHT_VALUE : DARK_VALUE;
      applyTheme(next);
    });
  });

  // Expose so other scripts can read/set theme programmatically
  window.ThemeManager = {
    get: currentTheme,
    set: applyTheme,
    toggle() {
      applyTheme(currentTheme() === DARK_VALUE ? LIGHT_VALUE : DARK_VALUE);
    },
  };
})();