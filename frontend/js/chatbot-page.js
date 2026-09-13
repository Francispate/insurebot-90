/* ============================================================
   InsureBot — chatbot-page.js
   Full-page chatbot (chat.html). Uses the same API.chat.*
   functions as the widget but renders into a dedicated page
   layout instead of a floating panel.

   Depends on: api.js (window.API, window.toast)
               auth.js (window.AuthUI)

   Markup hooks in chat.html:
     <div id="page-chat-messages"></div>
     <textarea id="page-chat-input"></textarea>
     <button id="page-chat-send-btn"></button>
     <button id="page-chat-clear-btn"></button>
     <span id="page-chat-session-id"></span>   (optional, debug)
   ============================================================ */

(function () {
  "use strict";

  // ─────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────
  const SESSION_KEY    = "insurebot_fullchat_session"; // separate key from widget
  const MAX_MESSAGES   = 200;
  const TYPING_DELAY_MS = 700;

  // ─────────────────────────────────────────
  // State
  // ─────────────────────────────────────────
  let sessionId  = sessionStorage.getItem(SESSION_KEY) || null;
  let messages   = []; // [{role, content}] — full conversation sent to API
  let isSending  = false;

  // ─────────────────────────────────────────
  // Markdown / sanitize (same as widget)
  // ─────────────────────────────────────────
  function sanitize(text) {
    if (!text) return "";
    var lines = text.split(/\r?\n/);
    var html  = "";
    var i     = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Table row detection
      if (/^\|/.test(line) && i + 1 < lines.length && /^\|[-| ]+\|/.test(lines[i + 1])) {
        var headers = line.split("|").filter((c) => c.trim() !== "").map((c) => `<th>${esc(c.trim())}</th>`).join("");
        html += `<table class="chat-table"><thead><tr>${headers}</tr></thead><tbody>`;
        i += 2;
        while (i < lines.length && /^\|/.test(lines[i])) {
          var cells = lines[i].split("|").filter((c) => c.trim() !== "").map((c) => `<td>${inline(c.trim())}</td>`).join("");
          html += `<tr>${cells}</tr>`;
          i++;
        }
        html += `</tbody></table>`;
        continue;
      }

      // Headings
      var hm = line.match(/^(#{1,3})\s+(.*)/);
      if (hm) { html += `<h${hm[1].length} class="chat-h">${inline(hm[2])}</h${hm[1].length}>`; i++; continue; }

      // HR
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { html += "<hr>"; i++; continue; }

      // Bullet list
      if (/^[-*]\s/.test(line)) {
        html += "<ul>";
        while (i < lines.length && /^[-*]\s/.test(lines[i])) {
          html += `<li>${inline(lines[i].replace(/^[-*]\s/, ""))}</li>`;
          i++;
        }
        html += "</ul>";
        continue;
      }

      // Numbered list
      if (/^\d+\.\s/.test(line)) {
        html += "<ol>";
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          html += `<li>${inline(lines[i].replace(/^\d+\.\s/, ""))}</li>`;
          i++;
        }
        html += "</ol>";
        continue;
      }

      // Blank line
      if (line.trim() === "") { html += "<br>"; i++; continue; }

      // Paragraph
      html += `<p>${inline(line)}</p>`;
      i++;
    }
    return html;
  }

  function inline(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g,     "<em>$1</em>")
      .replace(/`(.+?)`/g,       "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function esc(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─────────────────────────────────────────
  // Message rendering
  // ─────────────────────────────────────────
  function appendMessage(role, content) {
    const container = document.getElementById("page-chat-messages");
    if (!container) return null;

    const wrap   = document.createElement("div");
    wrap.className = `pchat-msg pchat-msg-${role}`;

    if (role === "assistant") {
      wrap.innerHTML = `
        <div class="pchat-avatar">IB</div>
        <div class="pchat-bubble">${sanitize(content)}</div>`;
    } else {
      wrap.innerHTML = `<div class="pchat-bubble">${sanitize(content)}</div>`;
    }

    container.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function showTyping() {
    const container = document.getElementById("page-chat-messages");
    if (!container) return null;
    const el = document.createElement("div");
    el.id        = "pchat-typing";
    el.className = "pchat-msg pchat-msg-assistant pchat-typing";
    el.innerHTML = `
      <div class="pchat-avatar">IB</div>
      <div class="pchat-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>`;
    container.appendChild(el);
    scrollToBottom();
    return el;
  }

  function removeTyping() {
    document.getElementById("pchat-typing")?.remove();
  }

  function scrollToBottom() {
    const el = document.getElementById("page-chat-messages");
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ─────────────────────────────────────────
  // Welcome message
  // ─────────────────────────────────────────
  function showWelcome() {
    const container = document.getElementById("page-chat-messages");
    if (!container) return;
    container.innerHTML = "";
    messages = [];

    const user = API.getUser();
    const name = user?.name ? `, ${user.name.split(" ")[0]}` : "";
    appendMessage(
      "assistant",
      `Hi${name}! I'm **InsureBot** 👋\n\nI'm your full AI insurance assistant. Ask me anything about:\n\n• Indian insurance policies & coverage\n• IRDAI regulations & guidelines\n• How to file claims (health, car, house, business)\n• Required documents for each claim type\n• Settlement processes & timelines\n• Tips to avoid claim rejection\n\nYou can also upload your policy document on the **Policy** page and I'll analyze it for you.\n\nHow can I help you today?`
    );
  }

  // ─────────────────────────────────────────
  // Send message
  // ─────────────────────────────────────────
  async function sendMessage() {
    const textarea = document.getElementById("page-chat-input");
    const sendBtn  = document.getElementById("page-chat-send-btn");
    if (!textarea || isSending) return;

    const content = textarea.value.trim();
    if (!content) return;

    if (messages.length >= MAX_MESSAGES) {
      toast("Conversation is very long — starting a new session.", "info");
      clearConversation();
      return;
    }

    isSending = true;
    textarea.value = "";
    textarea.style.height = "auto";
    if (sendBtn) sendBtn.disabled = true;
    updateSendState(true);

    appendMessage("user", content);
    messages.push({ role: "user", content });

    await delay(TYPING_DELAY_MS);
    showTyping();

    try {
      const res = await API.chat.send(messages, sessionId);

      if (res?.session_id) {
        sessionId = res.session_id;
        sessionStorage.setItem(SESSION_KEY, sessionId);
        const dbg = document.getElementById("page-chat-session-id");
        if (dbg) dbg.textContent = sessionId;
      }

      removeTyping();

      const botReply = res?.response || "Sorry, I couldn't generate a response right now.";
      appendMessage("assistant", botReply);
      messages.push({ role: "assistant", content: botReply });

    } catch (err) {
      removeTyping();
      const msg = err?.status === 401
        ? "Your session expired. Please log in again."
        : (err.message || "Something went wrong. Please try again.");
      appendMessage("assistant", msg);
    } finally {
      isSending = false;
      updateSendState(false);
      textarea.focus();
    }
  }

  function updateSendState(loading) {
    const btn = document.getElementById("page-chat-send-btn");
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle("sending", loading);
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─────────────────────────────────────────
  // Restore history
  // ─────────────────────────────────────────
  async function tryRestoreHistory() {
    if (!sessionId || !API.isLoggedIn()) return false;

    try {
      const res     = await API.chat.history(sessionId);
      const history = res?.history || [];
      if (!history.length) return false;

      const container = document.getElementById("page-chat-messages");
      if (!container) return false;

      container.innerHTML = "";
      messages = [];

      history.forEach((h) => {
        if (h.role === "system") return;
        appendMessage(h.role, h.content);
        messages.push({ role: h.role, content: h.content });
      });
      return true;
    } catch {
      return false;
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
    const dbg = document.getElementById("page-chat-session-id");
    if (dbg) dbg.textContent = "—";
  }

  // ─────────────────────────────────────────
  // Suggestion chips
  // ─────────────────────────────────────────
  function initSuggestions() {
    document.querySelectorAll("[data-suggest]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const textarea = document.getElementById("page-chat-input");
        if (!textarea) return;
        textarea.value = chip.dataset.suggest;
        textarea.dispatchEvent(new Event("input"));
        sendMessage();
      });
    });
  }

  // ─────────────────────────────────────────
  // Wire events
  // ─────────────────────────────────────────
  function wireEvents() {
    const textarea = document.getElementById("page-chat-input");
    const sendBtn  = document.getElementById("page-chat-send-btn");
    const clearBtn = document.getElementById("page-chat-clear-btn");

    if (textarea) {
      textarea.addEventListener("input", () => {
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
      });

      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    if (sendBtn) sendBtn.addEventListener("click", sendMessage);

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (messages.length === 0 || confirm("Start a new conversation? This clears the current chat.")) {
          clearConversation();
        }
      });
    }

    initSuggestions();
  }

  // ─────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    if (!API.isLoggedIn()) {
      // auth.js will redirect, but show a message in case
      const container = document.getElementById("page-chat-messages");
      if (container) {
        container.innerHTML = `
          <div class="pchat-auth-wall">
            <p>Please <a href="login.html">log in</a> to use InsureBot.</p>
          </div>`;
      }
      return;
    }

    wireEvents();

    // Restore session or show welcome
    const restored = await tryRestoreHistory();
    if (!restored) showWelcome();

    // Focus input
    document.getElementById("page-chat-input")?.focus();
  });

  window.FullChatPage = { clear: clearConversation, send: sendMessage };
})();