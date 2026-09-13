/* ============================================================
   InsureBot — chatbot-widget.js
   Floating chat widget: open/close, send messages, stream-style
   typing indicator, session persistence (sessionStorage), optional
   history load.

   Depends on api.js (window.API, window.toast).
   Works on any page that includes it — if the user is not logged in,
   the widget shows a login prompt instead of the input.

   Markup injected automatically — no HTML needed in pages.
   Just include this script and optionally style overrides via
   .chat-widget* CSS classes.

   Optional page-level hook:
     <div id="chat-launcher-anchor"></div>
     If present, the launcher button is appended there.
     Otherwise it is appended to <body>.
   ============================================================ */

(function () {
  "use strict";

  // ─────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────

  const SESSION_KEY    = "insurebot_chat_session";
  const WIDGET_OPEN_KEY = "insurebot_chat_open";
  const MAX_MESSAGES   = 200; // local display cap
  const TYPING_DELAY_MS = 600; // how long to show "…" before bot response

  // ─────────────────────────────────────────
  // State
  // ─────────────────────────────────────────

  let sessionId   = sessionStorage.getItem(SESSION_KEY) || null;
  let messages    = []; // [{role, content}] — full conversation for API
  let isOpen      = sessionStorage.getItem(WIDGET_OPEN_KEY) === "true";
  let isSending   = false;

  // ─────────────────────────────────────────
  // Build DOM
  // ─────────────────────────────────────────

  function buildWidget() {
    // ── Launcher button ──
    const launcher = document.createElement("button");
    launcher.id        = "chat-launcher";
    launcher.className = "chat-launcher";
    launcher.setAttribute("aria-label", "Open site help");
    launcher.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" class="chat-launcher-icon">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="chat-launcher-badge" id="chat-unread-badge" hidden>!</span>`;

    // ── Panel ──
    const panel = document.createElement("div");
    panel.id        = "chat-panel";
    panel.className = "chat-panel";
    panel.setAttribute("aria-live", "polite");
    panel.hidden    = !isOpen;

    panel.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-info">
          <div class="chat-avatar">IB</div>
          <div>
            <div class="chat-title">InsureBot</div>
            <div class="chat-subtitle">Site Help &amp; Navigation</div>
          </div>
        </div>
        <div class="chat-header-actions">
          <button id="chat-clear-btn" class="chat-icon-btn" title="New conversation" aria-label="New conversation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
            </svg>
          </button>
          <button id="chat-expand-btn" class="chat-icon-btn" title="Expand chat" aria-label="Expand chat">
            <svg id="chat-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
          <button id="chat-close-btn" class="chat-icon-btn" title="Close" aria-label="Close chat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="chat-messages" id="chat-messages">
        <!-- messages injected here -->
      </div>

      <div class="chat-input-area" id="chat-input-area">
        <!-- swapped with login prompt if not authed -->
      </div>`;

    // ── Wrapper ──
    const wrap = document.createElement("div");
    wrap.className = "chat-widget-wrap";
    wrap.appendChild(panel);
    wrap.appendChild(launcher);

    const anchor = document.getElementById("chat-launcher-anchor") || document.body;
    anchor.appendChild(wrap);

    return { launcher, panel, wrap };
  }

  // ─────────────────────────────────────────
  // Input area (auth-aware)
  // ─────────────────────────────────────────

  function renderInputArea() {
    const area = document.getElementById("chat-input-area");
    if (!area) return;

    if (!API.isLoggedIn()) {
      area.innerHTML = `
        <div class="chat-auth-prompt">
          <p>Please <a href="login.html">log in</a> to chat with InsureBot.</p>
        </div>`;
      return;
    }

    area.innerHTML = `
      <textarea id="chat-input" class="chat-textarea"
                rows="1" maxlength="2000"
                placeholder="Need help using this site?…"></textarea>
      <button id="chat-send-btn" class="chat-send-btn" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>`;

    const textarea = document.getElementById("chat-input");
    const sendBtn  = document.getElementById("chat-send-btn");

    // Auto-grow textarea
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
    });

    // Send on Enter (Shift+Enter = newline)
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener("click", sendMessage);
  }

  // ─────────────────────────────────────────
  // Message rendering
  // ─────────────────────────────────────────

  /**
   * Appends a message bubble to #chat-messages.
   * role: "user" | "assistant" | "system"
   * Returns the created element.
   */
  function appendMessage(role, content, id) {
    const container = document.getElementById("chat-messages");
    if (!container) return null;

    const wrap = document.createElement("div");
    wrap.className = `chat-msg chat-msg-${role}`;
    if (id) wrap.dataset.msgId = id;

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.innerHTML = sanitize(content);

    wrap.appendChild(bubble);
    container.appendChild(wrap);

    scrollToBottom();
    return wrap;
  }

  /** Shows a typing indicator ("…") while waiting for bot response. */
  function showTyping() {
    const container = document.getElementById("chat-messages");
    if (!container) return null;

    const el = document.createElement("div");
    el.id        = "chat-typing";
    el.className = "chat-msg chat-msg-assistant chat-typing";
    el.innerHTML = `<div class="chat-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
    container.appendChild(el);
    scrollToBottom();
    return el;
  }

  function removeTyping() {
    document.getElementById("chat-typing")?.remove();
  }

  function scrollToBottom() {
    const el = document.getElementById("chat-messages");
    if (el) el.scrollTop = el.scrollHeight;
  }

  /**
   * Minimal HTML sanitiser — escapes the content so injected user text
   * can't run arbitrary scripts, but allows line breaks.
   */
  /**
   * Lightweight markdown renderer for chat bubbles.
   * Handles: bold, italic, inline code, tables, bullet/numbered lists,
   * headings, horizontal rules, and literal <br> cleanup.
   */
  function sanitize(text) {
    if (!text) return "";
    var lines = text.split(/\r?\n/);
    var html = "";
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      // Table
      if (line.trim().charAt(0) === "|" && line.trim().slice(-1) === "|") {
        var tbl = [];
        while (i < lines.length && lines[i].trim().charAt(0) === "|") { tbl.push(lines[i]); i++; }
        html += renderTable(tbl);
        continue;
      }
      // Bullet list
      if (/^[\s]*[-*\u2022]\s+/.test(line)) {
        html += '<ul class="chat-md-list">';
        while (i < lines.length && /^[\s]*[-*\u2022]\s+/.test(lines[i])) {
          html += "<li>" + renderInline(lines[i].replace(/^[\s]*[-*\u2022]\s+/, "")) + "</li>";
          i++;
        }
        html += "</ul>";
        continue;
      }
      // Numbered list
      if (/^\s*\d+[.)]\s+/.test(line)) {
        html += '<ol class="chat-md-list">';
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          html += "<li>" + renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, "")) + "</li>";
          i++;
        }
        html += "</ol>";
        continue;
      }
      // Horizontal rule
      if (/^[-*_]{3,}\s*$/.test(line.trim())) {
        html += '<hr class="chat-md-hr">';
        i++; continue;
      }
      // Heading
      var hMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (hMatch) {
        var lvl = hMatch[1].length;
        html += '<h' + lvl + ' class="chat-md-h">' + renderInline(hMatch[2]) + '</h' + lvl + '>';
        i++; continue;
      }
      // Empty line
      if (line.trim() === "") { html += "<br>"; i++; continue; }
      // Normal line
      html += renderInline(line) + "<br>";
      i++;
    }
    html = html.replace(/(<br>\s*){3,}/g, "<br><br>");
    html = html.replace(/^(<br>)+/, "").replace(/(<br>)+$/, "");
    return html;
  }

  function renderTable(tableLines) {
    var out = '<div class="chat-md-table-wrap"><table class="chat-md-table">';
    var headerDone = false;
    for (var r = 0; r < tableLines.length; r++) {
      var row = tableLines[r];
      if (/^\|[\s\-:|]+\|$/.test(row.trim())) continue;
      var cells = row.split("|").filter(function(_, idx, arr) { return idx > 0 && idx < arr.length; });
      if (!headerDone) {
        out += "<thead><tr>" + cells.map(function(c) { return "<th>" + renderInline(c.trim()) + "</th>"; }).join("") + "</tr></thead><tbody>";
        headerDone = true;
      } else {
        out += "<tr>" + cells.map(function(c) { return "<td>" + renderInline(c.trim()) + "</td>"; }).join("") + "</tr>";
      }
    }
    if (headerDone) out += "</tbody>";
    out += "</table></div>";
    return out;
  }

  function renderInline(text) {
    if (!text) return "";
    text = text.replace(/<br\s*\/?>/gi, " ");
    var t = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(?<![*])\*([^*\n]+?)\*(?![*])/g, "<em>$1</em>");
    t = t.replace(/\b_([^_\n]+?)_\b/g, "<em>$1</em>");
    t = t.replace(/`([^`]+?)`/g, '<code class="chat-md-code">$1</code>');
    return t;
  }

  // ─────────────────────────────────────────
  // Welcome message
  // ─────────────────────────────────────────

  function showWelcome() {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    container.innerHTML = "";

    if (!API.isLoggedIn()) {
      appendMessage("assistant", "Hi! Log in to start chatting with InsureBot.");
      return;
    }

    const user = API.getUser();
    const name = user?.name ? `, ${user.name.split(" ")[0]}` : "";
    appendMessage(
      "assistant",
      `Hi${name}! 👋 I'm here to help you navigate **this website**.\n\nI can help you with:\n• How to submit a claim on this platform\n• Where to upload your policy document\n• How to read your dashboard & reports\n• Finding any feature on the site\n\nFor **in-depth insurance questions** (IRDAI rules, coverage advice, legal queries), use the full **AI Chat** page →\n\nWhat do you need help with?`
    );
  }

  // ─────────────────────────────────────────
  // Send message
  // ─────────────────────────────────────────

  async function sendMessage() {
    const textarea = document.getElementById("chat-input");
    const sendBtn  = document.getElementById("chat-send-btn");
    if (!textarea || !sendBtn) return;

    const content = textarea.value.trim();
    if (!content || isSending) return;

    // Enforce display cap
    if (messages.length >= MAX_MESSAGES) {
      toast("Conversation is very long. Starting a new session.", "info");
      clearConversation();
      return;
    }

    isSending = true;
    textarea.value = "";
    textarea.style.height = "auto";
    if (sendBtn) sendBtn.disabled = true;

    // Show user bubble immediately
    appendMessage("user", content);
    messages.push({ role: "user", content });

    // Typing indicator
    await delay(TYPING_DELAY_MS);
    const typingEl = showTyping();

    try {
      const res = await API.chat.send(messages, sessionId);

      if (res && res.session_id) {
        sessionId = res.session_id;
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }

      removeTyping();

      const botReply = res?.response || "I'm sorry, I couldn't generate a response.";
      appendMessage("assistant", botReply);
      messages.push({ role: "assistant", content: botReply });
    } catch (err) {
      removeTyping();
      const errMsg = err?.status === 401
        ? "You've been logged out. Please refresh the page and log in again."
        : (err.message || "Something went wrong. Please try again.");
      appendMessage("assistant", errMsg);
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
      textarea.focus();
    }
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─────────────────────────────────────────
  // Load history (optional, on widget open)
  // ─────────────────────────────────────────

  /**
   * If there's an existing session, tries to restore the last N turns
   * from the API so the conversation isn't lost on page reload.
   */
  async function tryRestoreHistory() {
    if (!sessionId || !API.isLoggedIn()) return;

    try {
      const res     = await API.chat.history(sessionId);
      const history = res?.history || [];
      if (!history.length) return;

      const container = document.getElementById("chat-messages");
      if (!container) return;

      container.innerHTML = "";
      messages = [];

      // History is returned ASC for a given session
      history.forEach((h) => {
        if (h.role === "system") return; // skip system messages in display
        appendMessage(h.role, h.content, h.id);
        messages.push({ role: h.role, content: h.content });
      });
    } catch {
      // Non-fatal — start fresh
    }
  }

  // ─────────────────────────────────────────
  // Clear conversation
  // ─────────────────────────────────────────

  function clearConversation() {
    sessionId = null;
    messages  = [];
    sessionStorage.removeItem(SESSION_KEY);
    showWelcome();
  }

  // ─────────────────────────────────────────
  // Open / Close
  // ─────────────────────────────────────────

  function openWidget() {
    const panel = document.getElementById("chat-panel");
    if (!panel) return;
    panel.hidden = false;
    isOpen = true;
    sessionStorage.setItem(WIDGET_OPEN_KEY, "true");

    // Hide unread badge when opening
    const badge = document.getElementById("chat-unread-badge");
    if (badge) badge.hidden = true;

    const textarea = document.getElementById("chat-input");
    if (textarea) textarea.focus();
  }

  function closeWidget() {
    const panel = document.getElementById("chat-panel");
    if (!panel) return;
    panel.hidden = true;
    isOpen = false;
    sessionStorage.setItem(WIDGET_OPEN_KEY, "false");
  }

  // ─────────────────────────────────────────
  // Wire events
  // ─────────────────────────────────────────


  // ─────────────────────────────────────────
  // Expand / collapse
  // ─────────────────────────────────────────

  let isExpanded = false;

  // SVG paths for expand vs collapse icons
  const ICON_EXPAND   = '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>';
  const ICON_COLLAPSE = '<polyline points="4 14 4 20 10 20"/><polyline points="20 10 20 4 14 4"/><line x1="4" y1="20" x2="11" y2="13"/><line x1="20" y1="4" x2="13" y2="11"/>';

  function toggleExpand() {
    const panel  = document.getElementById("chat-panel");
    const btn    = document.getElementById("chat-expand-btn");
    const icon   = document.getElementById("chat-expand-icon");
    if (!panel || !btn || !icon) return;

    isExpanded = !isExpanded;
    panel.classList.toggle("chat-expanded", isExpanded);
    btn.classList.toggle("active", isExpanded);
    btn.title = isExpanded ? "Collapse chat" : "Expand chat";
    btn.setAttribute("aria-label", isExpanded ? "Collapse chat" : "Expand chat");
    icon.innerHTML = isExpanded ? ICON_COLLAPSE : ICON_EXPAND;
    scrollToBottom();
  }

  function wireEvents({ launcher }) {
    launcher.addEventListener("click", () => {
      if (isOpen) {
        closeWidget();
      } else {
        openWidget();
        if (!messages.length) {
          tryRestoreHistory().then(() => {
            if (!messages.length) showWelcome();
          });
        }
      }
    });

    document.getElementById("chat-close-btn")?.addEventListener("click", closeWidget);
    document.getElementById("chat-expand-btn")?.addEventListener("click", toggleExpand);

    document.getElementById("chat-clear-btn")?.addEventListener("click", () => {
      if (confirm("Start a new conversation? This will clear the current chat.")) {
        clearConversation();
      }
    });
  }

  // ─────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    const { launcher, panel } = buildWidget();
    renderInputArea();
    wireEvents({ launcher });

    if (isOpen) {
      openWidget();
      tryRestoreHistory().then(() => {
        if (!messages.length) showWelcome();
      });
    }
  });

  // Expose for programmatic use (e.g. open widget from a "Chat" CTA button)
  window.ChatWidget = {
    open:  openWidget,
    close: closeWidget,
    clear: clearConversation,
    send:  sendMessage,
  };
})();