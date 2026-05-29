// =============================================
//  chatbot.js — Calls Flask backend at /chat
//  Backend uses Grok (xAI) API
// =============================================

let conversationHistory = [];
let isTyping = false;
let currentSessionTimestamp = null; // Groups active chats into a unified historical session block

// ── Lifecycle Hooks ──────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById('user-input');
  if (inputEl) {
    inputEl.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });
  }
  
  // Render welcome message and load database sidebar entries immediately
  resetChatWindow();
  loadSidebarHistory();
});

// ── Sidebar History Loading ──────────────────

async function loadSidebarHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;

  try {
    const response = await fetch("/api/history");
    const data = await response.json();
    
    container.innerHTML = ""; // Clear existing sidebar items

    if (!data.sessions || data.sessions.length === 0) {
      container.innerHTML = '<div style="color:#888; font-size:12px; text-align:center; padding:20px;">No past chats saved yet.</div>';
      return;
    }

    data.sessions.forEach(session => {
      const btn = document.createElement("button");
      btn.className = "history-item";
      // Display the session preview text title
      btn.innerText = session.preview || "Untitled Chat Session";
      
      // When clicked, load the historical data into the UI view
      btn.onclick = () => loadPastSession(session);
      container.appendChild(btn);
    });
  } catch (err) {
    console.error("Error retrieving historical memory index logs:", err);
  }
}

function loadPastSession(session) {
  // Lock our frontend variable to this specific historical block execution path
  currentSessionTimestamp = session.timestamp;
  
  // Clear the messages panel array visually
  document.getElementById('messages').innerHTML = "";
  
  // Remap messages back into global runtime state memory space
  conversationHistory = [];
  
  session.messages.forEach(msg => {
    // Map backend data storage terms to frontend bubble styling states ('bot' vs 'assistant')
    const roleLabel = (msg.role === 'bot' || msg.role === 'model') ? 'bot' : 'user';
    addMessage(roleLabel, msg.content);
    
    // Maintain conversational engine accuracy
    conversationHistory.push({ role: msg.role, content: msg.content });
  });
}

function startNewChat() {
  currentSessionTimestamp = null; // Generates a fresh timestamp entry on next submit
  resetChatWindow();
}

function resetChatWindow() {
  document.getElementById('messages').innerHTML = "";
  conversationHistory = [];
  addMessage(
    'bot',
    "Hello! 👋 I'm your Healthcare Assistant, here to help answer health questions for seniors and their caregivers.\n\nHow can I help you today?"
  );
}

// ── Standard Send Core Workflows ─────────────

async function sendMessage() {
  const input = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  if (!input) return;

  const text = input.value.trim();
  if (!text || isTyping) return;

  input.value = '';
  input.style.height = 'auto';

  isTyping = true;
  if (sendBtn) sendBtn.disabled = true;

  addMessage('user', text);
  showTyping();

  // If this is a completely new conversation thread, initialize its timestamp mapping id right now
  if (!currentSessionTimestamp) {
    currentSessionTimestamp = str(Date.now() / 1000);
  }

  // Push user message into the payload
  conversationHistory.push({ role: 'user', content: text });

  try {
    const response = await fetch("/chat", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: conversationHistory,
        timestamp: currentSessionTimestamp
      }),
    });

    if (!response.ok) throw new Error('Network transaction failure ' + response.status);

    const data = await response.json();
    removeTyping();
    addMessage('bot', data.reply);
    
    // Push bot response to preserve runtime memory context
    conversationHistory.push({ role: 'model', content: data.reply });

    // Refresh the sidebar entries immediately so the current chat shows up or updates
    loadSidebarHistory();

  } catch (err) {
    removeTyping();
    console.error('API Error:', err);
    addMessage('bot', "I'm sorry, I encountered an issue retrieving that care insight. Please check your connection.");
  }

  isTyping = false;
  if (sendBtn) sendBtn.disabled = false;
  input.focus();
}

// ── DOM Helpers ──────────────────────────────

function addMessage(role, text) {
  const container = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = "msg " + role;

  const avatarHTML =
    role === "bot"
      ? '<div class="msg-avatar bot-av">🏥</div>'
      : '<div class="msg-avatar user-av">You</div>';

  const formatted = text.replace(/\n/g, "<br>");
  div.innerHTML = avatarHTML + '<div class="msg-bubble">' + formatted + "</div>";

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  const container = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = "typing-indicator";
  div.innerHTML =
    '<div class="msg-avatar bot-av">🏥</div>' +
    '<div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

// ── API Call to Flask /chat ───────────────────

async function callBackend(userMessage) {
  conversationHistory.push({ role: "user", content: userMessage });

  const response = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history: conversationHistory }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Server error " + response.status);
  }

  const data = await response.json();
  conversationHistory.push({ role: "assistant", content: data.reply });
  return data.reply;
}

// ── Send Flow ────────────────────────────────

async function sendMessage() {
  const input = document.getElementById("user-input");
  const text = input.value.trim();
  if (!text || isTyping) return;

  input.value = "";
  input.style.height = "auto";

  isTyping = true;
  document.getElementById("send-btn").disabled = true;

  addMessage("user", text);
  showTyping();

  try {
    const reply = await callBackend(text);
    removeTyping();
    addMessage("bot", reply);
  } catch (err) {
    removeTyping();
    console.error("Error:", err);
    addMessage("bot", "Sorry, something went wrong. Please check your XAI_API_KEY in .env and try again.");
  }

  isTyping = false;
  document.getElementById("send-btn").disabled = false;
  input.focus();
}

function sendQuick(text) {
  document.getElementById("user-input").value = text;
  sendMessage();
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// Auto-resize textarea
document.getElementById("user-input").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 100) + "px";
});

// Welcome message
addMessage(
  "bot",
  "Hello! 👋 I'm your Healthcare Assistant, powered by Grok AI.\n\nI'm here to help answer health questions for seniors and their caregivers. Ask me about medications, nutrition, chronic conditions, exercise, and more!"
);
