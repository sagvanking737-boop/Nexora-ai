'use strict';

/* =============================================
   AUTH SYSTEM
   ============================================= */

const AUTH = {
  currentUser: null,   // { username, isGuest }
  sessionToken: null,

  // Register via API (server-side SQLite)
  async register(username, password) {
    username = username.trim();
    if (!username || username.length < 2) return { ok: false, msg: 'Benutzername muss mindestens 2 Zeichen haben.' };
    if (!password || password.length < 4)  return { ok: false, msg: 'Passwort muss mindestens 4 Zeichen haben.' };
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, msg: data.error || 'Registrierung fehlgeschlagen.' };
      return { ok: true, token: data.token, username: data.username };
    } catch (e) {
      console.error('Register error:', e);
      return { ok: false, msg: 'Server nicht erreichbar. Versuche es später erneut.' };
    }
  },

  // Login via API (server-side SQLite)
  async login(username, password) {
    username = username.trim();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, msg: data.error || 'Login fehlgeschlagen.' };
      return { ok: true, token: data.token, username: data.username };
    } catch (e) {
      console.error('Login error:', e);
      return { ok: false, msg: 'Server nicht erreichbar. Versuche es später erneut.' };
    }
  },

  setCurrentUser(username, isGuest = false, token = null) {
    this.currentUser = { username, isGuest };
    this.sessionToken = token;
    // localStorage statt sessionStorage → User bleibt angemeldet!
    localStorage.setItem('_session', JSON.stringify({ username, isGuest, token }));
  },

  async loadSession() {
    try {
      const s = localStorage.getItem('_session');
      if (!s) return false;
      const parsed = JSON.parse(s);
      // Guest sessions laden direkt
      if (parsed.isGuest) {
        this.currentUser = { username: parsed.username, isGuest: true };
        return true;
      }
      // Registrierte User: Token beim Server prüfen
      if (parsed.token) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${parsed.token}` },
          });
          if (res.ok) {
            const data = await res.json();
            this.currentUser = { username: data.username, isGuest: false };
            this.sessionToken = parsed.token;
            return true;
          }
        } catch (e) {
          console.warn('Session validation failed, using cached data:', e);
        }
        // Fallback: Wenn Server offline ist, nutze gecachte Daten
        this.currentUser = { username: parsed.username, isGuest: false };
        this.sessionToken = parsed.token;
        return true;
      }
    } catch {}
    return false;
  },

  async logout() {
    // Server-seitiges Logout
    if (this.sessionToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.sessionToken}` },
        });
      } catch {}
    }
    this.currentUser = null;
    this.sessionToken = null;
    localStorage.removeItem('_session');
  },

  storageKey(suffix) {
    const u = this.currentUser?.username || 'guest';
    return `chat_${u}_${suffix}`;
  },
};

/* =============================================
   STATE
   ============================================= */

const STATE = {
  chats: {},
  activeChatId: null,
  isStreaming: false,
  voiceModeActive: false,
  settings: {
    apiKey: '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',
    model: 'anthropic/claude-sonnet-4-7',
    systemPrompt: `Du bist Nexora, ein hochentwickelter KI-Assistent spezialisiert auf Software-Entwicklung.

Deine Kernkompetenzen:
- Schreibe sauberen, effizienten und gut dokumentierten Code
- Erkläre komplexe Konzepte verständlich mit passenden Codebeispielen
- Führe Code-Reviews durch und identifiziere Bugs und Best-Practice-Verletzungen
- Hilf bei Systemarchitektur, Algorithmen und Datenstrukturen

Formatierungsregeln:
- Nutze immer Markdown-Formatierung
- Code IMMER in Codeblöcken mit korrektem Syntax-Highlighting
- Sei präzise und direkt in deinen Antworten`,
    maxTokens: 8192,
    temperature: 0.7,
    voiceLanguage: 'de-DE',
    voiceVoice: 'auto',
  },
};

/* =============================================
   DOM
   ============================================= */

const $ = (id) => document.getElementById(id);

const els = {
  authScreen:        $('auth-screen'),
  app:               $('app'),
  sidebar:           $('sidebar'),
  toggleSidebar:     $('toggle-sidebar'),
  mobileCloseSidebar:$('mobile-close-sidebar'),
  sidebarOverlay:    $('sidebar-overlay'),
  newChatBtn:        $('new-chat-btn'),
  chatList:          $('chat-list'),
  chatTitle:         $('chat-title'),
  modelBadge:        $('model-badge'),
  modelSelect:       $('model-select'),
  messagesContainer: $('messages-container'),
  welcomeScreen:     $('welcome-screen'),
  messages:          $('messages'),
  userInput:         $('user-input'),
  sendBtn:           $('send-btn'),
  charCounter:       $('char-counter'),
  tokenEstimate:     $('token-estimate'),
  clearChatBtn:      $('clear-chat-btn'),
  exportBtn:         $('export-btn'),
  settingsBtn:       $('settings-btn'),
  logoutBtn:         $('logout-btn'),
  settingsModal:     $('settings-modal'),
  closeSettings:     $('close-settings'),
  cancelSettings:    $('cancel-settings-btn'),
  saveSettings:      $('save-settings-btn'),
  apiKeyInput:       $('api-key-input'),
  toggleKeyVis:      $('toggle-key-visibility'),
  systemPromptInput: $('system-prompt-input'),
  maxTokensInput:    $('max-tokens-input'),
  tempSlider:        $('temp-slider'),
  tempValue:         $('temp-value'),
  voiceLangSelect:   $('voice-lang-select'),
  voiceNameSelect:   $('voice-name-select'),
  systemPromptModal: $('system-prompt-modal'),
  systemPromptBtn:   $('system-prompt-btn'),
  closeSystemPrompt: $('close-system-prompt'),
  systemPromptQuick: $('system-prompt-quick'),
  saveSystemPrompt:  $('save-system-prompt'),
  codeModeBtn:       $('code-mode-btn'),
  userAvatarSidebar: $('user-avatar-sidebar'),
  userDisplayName:   $('user-display-name'),
  toast:             $('toast'),
  upgradeBtn:        $('upgrade-btn'),
  subscriptionModal: $('subscription-modal'),
  closeSubscription: $('close-subscription'),
  feedbackChannelBtn:$('feedback-channel-btn'),
  feedbackContainer: $('feedback-container'),
  feedbackMessages:  $('feedback-messages'),
  feedbackUsername:  $('feedback-username'),
  feedbackRole:      $('feedback-role'),
  feedbackInput:     $('feedback-input'),
  sendFeedbackBtn:   $('send-feedback-btn'),
  modeSelect:        $('mode-select'),
  themeDarkBtn:      $('theme-dark-btn'),
  themeLightBtn:     $('theme-light-btn'),
  suggestionsGrid:   document.querySelector('.suggestions-grid'),
  micBtn:            $('mic-btn'),
  voiceOverlay:      $('voice-overlay'),
  voiceStatus:       $('voice-status'),
  voiceTranscript:   $('voice-transcript'),
  voiceResponse:     $('voice-response'),
  voiceCloseBtn:     $('voice-close-btn'),
  voiceBars:         $('voice-bars'),
};

/* =============================================
   AUTH UI FUNCTIONS (global, called from HTML)
   ============================================= */

window.showTab = function(tab) {
  $('form-login').classList.toggle('hidden', tab !== 'login');
  $('form-register').classList.toggle('hidden', tab !== 'register');
  $('tab-login').classList.toggle('active', tab === 'login');
  $('tab-register').classList.toggle('active', tab === 'register');
  $('auth-subtitle').textContent = tab === 'login'
    ? 'Melde dich an, um deine Gespräche zu laden.'
    : 'Erstelle ein Konto, um deine Gespräche zu speichern.';
};

window.doLogin = async function() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  const errEl = $('login-error');
  const btn = $('login-btn');
  errEl.classList.add('hidden');

  if (!username || !password) {
    errEl.textContent = 'Bitte Benutzername und Passwort eingeben.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Anmelden...';

  const result = await AUTH.login(username, password);
  if (!result.ok) {
    errEl.textContent = result.msg;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Anmelden';
    return;
  }

  AUTH.setCurrentUser(result.username, false, result.token);
  btn.disabled = false;
  btn.textContent = 'Anmelden';
  showApp();
};

window.doRegister = async function() {
  const username = $('reg-username').value.trim();
  const password = $('reg-password').value;
  const password2 = $('reg-password2').value;
  const errEl = $('reg-error');
  const btn = $('register-btn');
  errEl.classList.add('hidden');

  if (password !== password2) {
    errEl.textContent = 'Passwörter stimmen nicht überein.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Erstelle Konto...';

  const result = await AUTH.register(username, password);
  if (!result.ok) {
    errEl.textContent = result.msg;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Konto erstellen';
    return;
  }

  // Auto-login after register
  AUTH.setCurrentUser(result.username, false, result.token);
  btn.disabled = false;
  btn.textContent = 'Konto erstellen';
  showApp();
  showToast('Konto erstellt ✓', 'success');
};

window.doGuestLogin = function() {
  AUTH.setCurrentUser('Gast_' + Math.random().toString(36).slice(2, 6), true);
  showApp();
};

function showApp() {
  els.authScreen.classList.add('hidden');
  els.app.classList.remove('hidden');
  const user = AUTH.currentUser;
  const initial = (user.username || 'G')[0].toUpperCase();
  els.userAvatarSidebar.textContent = initial;
  els.userDisplayName.textContent = user.username;
  loadFromStorage();
  const chatIds = Object.keys(STATE.chats);
  if (chatIds.length === 0) {
    startNewChat();
  } else {
    const latest = chatIds.sort((a, b) => STATE.chats[b].createdAt - STATE.chats[a].createdAt)[0];
    switchToChat(latest);
  }
  renderChatList();
  els.userInput.focus();
  closeSidebarOnMobile();
  if (STATE.settings.apiKey) {
    showToast(`Willkommen, ${user.username}! ✓`, 'success');
  }
}

/* =============================================
   MARKED.JS CONFIG
   ============================================= */

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang }).value; } catch {}
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

const renderer = new marked.Renderer();
renderer.code = (code, lang) => {
  const language = (lang || 'plaintext').toLowerCase();
  let highlighted;
  if (hljs.getLanguage(language)) {
    try { highlighted = hljs.highlight(code, { language }).value; }
    catch { highlighted = hljs.highlightAuto(code).value; }
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }
  const id = `code-${Math.random().toString(36).slice(2, 8)}`;
  return `<div class="code-block-wrap">
    <div class="code-block-header">
      <span class="code-lang">${language}</span>
      <button class="copy-btn" data-code-id="${id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Kopieren
      </button>
    </div>
    <pre><code id="${id}" class="hljs language-${language}">${highlighted}</code></pre>
  </div>`;
};
marked.use({ renderer });

/* =============================================
   PERSISTENCE (per-user)
   ============================================= */

function loadFromStorage() {
  try {
    const saved = localStorage.getItem(AUTH.storageKey('data'));
    if (saved) {
      const data = JSON.parse(saved);
      Object.assign(STATE.chats, data.chats || {});
      const stored = data.settings || {};
      if (!stored.apiKey) delete stored.apiKey;
      // Remap old models
      if (stored.model && !stored.model.includes('/')) {
        const remap = {
          'claude-sonnet-4-7': 'anthropic/claude-sonnet-4-7',
          'claude-haiku-4-7':  'anthropic/claude-haiku-4-7',
          'claude-opus-4-7':   'anthropic/claude-opus-4-7',
          'claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
        };
        stored.model = remap[stored.model] || 'anthropic/claude-sonnet-4-7';
      }
      Object.assign(STATE.settings, stored);
    }
  } catch (e) { console.warn('Storage load error:', e); }
  // Sync UI
  els.modelSelect.value = STATE.settings.model;
  updateModelBadge();
}

function saveToStorage() {
  try {
    localStorage.setItem(AUTH.storageKey('data'), JSON.stringify({
      chats: STATE.chats,
      settings: STATE.settings,
    }));
  } catch (e) { console.warn('Storage save error:', e); }
}

/* =============================================
   CHAT MANAGEMENT
   ============================================= */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createChat() {
  const id = generateId();
  STATE.chats[id] = { id, title: 'Neuer Chat', messages: [], createdAt: Date.now() };
  saveToStorage();
  return id;
}

function switchToChat(id) {
  isFeedbackActive = false;
  els.feedbackContainer.classList.add('hidden');
  els.messagesContainer.classList.remove('hidden');
  document.querySelector('.input-area').classList.remove('hidden');
  els.feedbackChannelBtn.classList.remove('active');

  STATE.activeChatId = id;
  renderChatList();
  renderMessages();
  const chat = STATE.chats[id];
  els.chatTitle.textContent = chat.title;
  saveToStorage();
  closeSidebarOnMobile();
}

function deleteChat(id) {
  delete STATE.chats[id];
  if (STATE.activeChatId === id) {
    const ids = Object.keys(STATE.chats);
    if (ids.length > 0) switchToChat(ids[ids.length - 1]);
    else startNewChat();
  }
  renderChatList();
  saveToStorage();
}

function startNewChat() {
  isFeedbackActive = false;
  els.feedbackContainer.classList.add('hidden');
  els.messagesContainer.classList.remove('hidden');
  document.querySelector('.input-area').classList.remove('hidden');
  els.feedbackChannelBtn.classList.remove('active');

  const id = createChat();
  switchToChat(id);
}

function updateChatTitle(id, firstMessage) {
  if (!STATE.chats[id]) return;
  const title = firstMessage.slice(0, 50).replace(/\n/g, ' ').trim() || 'Neuer Chat';
  STATE.chats[id].title = title;
  els.chatTitle.textContent = title;
  renderChatList();
  saveToStorage();
}

/* =============================================
   RENDERING
   ============================================= */

function renderChatList() {
  els.chatList.innerHTML = '';
  const sorted = Object.values(STATE.chats).sort((a, b) => b.createdAt - a.createdAt);
  for (const chat of sorted) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === STATE.activeChatId ? ' active' : '');
    item.innerHTML = `
      <span class="chat-item-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </span>
      <span class="chat-item-name" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</span>
      <button class="chat-item-delete" data-id="${chat.id}" title="Löschen">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-item-delete')) {
        e.stopPropagation();
        deleteChat(chat.id);
      } else {
        switchToChat(chat.id);
      }
    });
    els.chatList.appendChild(item);
  }
}

function renderMessages() {
  const chat = STATE.chats[STATE.activeChatId];
  if (!chat) return;
  els.messages.innerHTML = '';
  els.welcomeScreen.classList.toggle('hidden', chat.messages.length > 0);
  for (const msg of chat.messages) {
    appendMessageToDOM(msg.role, msg.content, false);
  }
  scrollToBottom();
}

function appendMessageToDOM(role, content, animate = true) {
  els.welcomeScreen.classList.add('hidden');
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  if (role === 'user') {
    msgEl.innerHTML = `<div class="message-bubble">${escapeHtml(content)}</div>`;
  } else {
    const rendered = renderMarkdown(content);
    msgEl.innerHTML = `
      <div class="message-inner">
        <div class="message-avatar" style="background: none;"><img src="ai-avatar-premium.png" class="message-avatar-img" alt="AI Avatar"></div>
        <div class="message-content-wrap" style="flex:1;min-width:0;">
          <div class="message-content">${rendered}</div>
          <div class="message-actions">
            <button class="msg-action-btn copy-msg-btn">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Kopieren
            </button>
          </div>
        </div>
      </div>`;
  }

  if (animate) msgEl.style.animation = 'slideIn 0.2s ease';
  els.messages.appendChild(msgEl);

  if (role === 'assistant') {
    msgEl.querySelectorAll('.copy-btn').forEach(btn => attachCopyBtn(btn));
    msgEl.querySelector('.copy-msg-btn')?.addEventListener('click', () => {
      copyToClipboard(content);
      showToast('Antwort kopiert', 'success');
    });
  }

  scrollToBottom();
  return msgEl;
}

function renderMarkdown(text) {
  try { return marked.parse(text); }
  catch { return escapeHtml(text); }
}

function createStreamingMessage() {
  els.welcomeScreen.classList.add('hidden');
  const msgEl = document.createElement('div');
  msgEl.className = 'message assistant';
  msgEl.innerHTML = `
    <div class="message-inner">
      <div class="message-avatar" style="background: none;"><img src="ai-avatar-premium.png" class="message-avatar-img" alt="AI Avatar"></div>
      <div class="message-content-wrap" style="flex:1;min-width:0;">
        <div class="message-content">
          <div class="thinking-indicator">
            <div class="soundwave-bars"><span></span><span></span><span></span><span></span><span></span></div>
            <span>Nexora denkt nach...</span>
          </div>
        </div>
      </div>
    </div>`;
  els.messages.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

function updateStreamingMessage(msgEl, fullText) {
  const contentEl = msgEl.querySelector('.message-content');
  contentEl.innerHTML = renderMarkdown(fullText) + '<span class="stream-cursor"></span>';
  contentEl.querySelectorAll('.copy-btn').forEach(btn => attachCopyBtn(btn));
  scrollToBottom();
}

function finalizeStreamingMessage(msgEl, fullText) {
  const contentWrap = msgEl.querySelector('.message-content-wrap');
  const contentEl = msgEl.querySelector('.message-content');
  contentEl.innerHTML = renderMarkdown(fullText);
  contentEl.querySelectorAll('.copy-btn').forEach(btn => attachCopyBtn(btn));
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = `
    <button class="msg-action-btn copy-msg-btn">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Kopieren
    </button>`;
  actions.querySelector('.copy-msg-btn').addEventListener('click', () => {
    copyToClipboard(fullText);
    showToast('Antwort kopiert', 'success');
  });
  contentWrap.appendChild(actions);
  scrollToBottom();
}

function attachCopyBtn(btn) {
  btn.addEventListener('click', () => {
    const codeEl = document.getElementById(btn.dataset.codeId);
    if (!codeEl) return;
    copyToClipboard(codeEl.textContent);
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Kopiert!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Kopieren`;
    }, 2000);
  });
}

function scrollToBottom() {
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

/* =============================================
   API CALL WITH STREAMING
   ============================================= */

async function sendMessage() {
  const text = els.userInput.value.trim();
  if (!text || STATE.isStreaming) return;

  if (!STATE.settings.apiKey) {
    showToast('Bitte gib deinen Nexora API Key in den Einstellungen ein. Kontaktiere den Besitzer für einen Key.', 'error');
    openSettingsModal();
    return;
  }

  STATE.isStreaming = true;
  setInputEnabled(false);
  els.userInput.value = '';
  autoResizeTextarea();
  updateCharCounter();

  const chat = STATE.chats[STATE.activeChatId];
  if (chat.messages.length === 0) updateChatTitle(STATE.activeChatId, text);

  chat.messages.push({ role: 'user', content: text });
  appendMessageToDOM('user', text);
  saveToStorage();

  const streamEl = createStreamingMessage();
  let fullResponse = '';

  try {
    const messages = [];
    if (STATE.settings.systemPrompt.trim()) {
      messages.push({ role: 'system', content: STATE.settings.systemPrompt.trim() });
    }
    chat.messages.forEach(m => messages.push({ role: m.role, content: m.content }));

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.settings.apiKey}`,
        'HTTP-Referer': 'https://nexora-ai-app',
        'X-Title': 'Nexora AI App',
      },
      body: JSON.stringify({
        model: STATE.settings.model,
        max_tokens: STATE.settings.maxTokens,
        temperature: STATE.settings.temperature,
        stream: true,
        messages,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const evt = JSON.parse(jsonStr);
          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta;
            updateStreamingMessage(streamEl, fullResponse);
          }
        } catch {}
      }
    }

    finalizeStreamingMessage(streamEl, fullResponse);
    chat.messages.push({ role: 'assistant', content: fullResponse });
    saveToStorage();

  } catch (err) {
    console.error('API error:', err);
    const isCreditsErr = err.message.toLowerCase().includes('credit') || err.message.toLowerCase().includes('afford');
    const isKeyErr = err.message.toLowerCase().includes('api') || err.message.toLowerCase().includes('key') || err.message.toLowerCase().includes('auth');
    let extra = '';
    if (isCreditsErr) {
      extra = `<br><br>💳 <strong>Serverlimit erreicht!</strong><br>
        Die maximale Anzahl an Anfragen wurde vorübergehend erreicht.<br>
        <b>Lösung:</b> Versuche es in ein paar Minuten erneut oder wähle ein anderes KI-Modell.`;
    } else if (isKeyErr) {
      extra = '<br><small>Nexora AI ist vorübergehend nicht erreichbar. Bitte versuche es gleich erneut.</small>';
    }
    streamEl.querySelector('.message-content').innerHTML =
      `<div style="color:#f87171;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);border-radius:8px;padding:12px 16px;line-height:1.7;">
        <strong>Fehler:</strong> ${escapeHtml(err.message)}${extra}
      </div>`;
  } finally {
    STATE.isStreaming = false;
    setInputEnabled(true);
    els.userInput.focus();
  }
}

/* =============================================
   INPUT HANDLING
   ============================================= */

function setInputEnabled(enabled) {
  els.userInput.disabled = !enabled;
  els.sendBtn.disabled = !enabled || !els.userInput.value.trim();
}

function autoResizeTextarea() {
  const ta = els.userInput;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 400) + 'px';
}

function updateCharCounter() {
  const len = els.userInput.value.length;
  const estimatedTokens = Math.ceil(len / 4);
  els.charCounter.textContent = `${len.toLocaleString()} Zeichen`;
  els.tokenEstimate.textContent = `~${estimatedTokens.toLocaleString()} Tokens`;
  els.sendBtn.disabled = len === 0 || STATE.isStreaming;
}

/* =============================================
   SETTINGS
   ============================================= */

function openSettingsModal() {
  els.apiKeyInput.value = STATE.settings.apiKey;
  els.systemPromptInput.value = STATE.settings.systemPrompt;
  els.maxTokensInput.value = STATE.settings.maxTokens;
  els.tempSlider.value = STATE.settings.temperature;
  els.tempValue.textContent = STATE.settings.temperature;
  if (els.voiceLangSelect) els.voiceLangSelect.value = STATE.settings.voiceLanguage || 'de-DE';
  populateVoiceOptions();
  if (els.voiceNameSelect) els.voiceNameSelect.value = STATE.settings.voiceVoice || 'auto';
  els.settingsModal.classList.remove('hidden');
}

function closeSettingsModal() { els.settingsModal.classList.add('hidden'); }

function populateVoiceOptions() {
  if (!('speechSynthesis' in window) || !els.voiceNameSelect || !els.voiceLangSelect) return;
  const lang = els.voiceLangSelect.value || 'de-DE';
  const voices = window.speechSynthesis.getVoices();
  const select = els.voiceNameSelect;
  
  const currentVal = select.value;
  select.innerHTML = '<option value="auto">Automatisch (Beste Stimme)</option>';
  
  const langPrefix = lang.split('-')[0];
  let matchCount = 0;
  
  voices.forEach(v => {
    if (v.lang.startsWith(langPrefix)) {
      matchCount++;
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `Stimme ${matchCount} (${v.name})`;
      select.appendChild(opt);
    }
  });
  
  if (Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  }
}

function saveSettings() {
  STATE.settings.apiKey       = els.apiKeyInput.value.trim();
  STATE.settings.systemPrompt = els.systemPromptInput.value;
  STATE.settings.maxTokens    = parseInt(els.maxTokensInput.value) || 8192;
  STATE.settings.temperature  = parseFloat(els.tempSlider.value);
  if (els.voiceLangSelect) STATE.settings.voiceLanguage = els.voiceLangSelect.value;
  if (els.voiceNameSelect) STATE.settings.voiceVoice = els.voiceNameSelect.value;
  saveToStorage();
  closeSettingsModal();
  showToast('Einstellungen gespeichert ✓', 'success');
}

function updateModelBadge() {
  const names = {
    'anthropic/claude-sonnet-4-7':       'Claude Sonnet 4.7',
    'anthropic/claude-haiku-4-7':        'Claude Haiku 4.7',
    'anthropic/claude-opus-4-7':         'Claude Opus 4.7',
    'anthropic/claude-sonnet-4-5':       'Claude Sonnet 4.5',
    'anthropic/claude-haiku-4-5':        'Claude Haiku 4.5',
    'anthropic/claude-opus-4-5':         'Claude Opus 4.5',
    'anthropic/claude-3-7-sonnet':       'Claude 3.7 Sonnet',
    'google/gemini-2.5-pro-preview':     'Gemini 2.5 Pro',
    'openai/gpt-4o':                     'GPT-4o',
    'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B',
    'google/gemma-4-26b-a4b-it:free':    'Gemma 4 26B (Kostenlos)',
    'meta-llama/llama-3.3-70b-instruct:free':'Llama 3.3 70B (Kostenlos)',
    'deepseek/deepseek-v4-flash:free':   'DeepSeek V4 (Kostenlos)',
    'qwen/qwen3-coder:free':             'Qwen 3 Coder (Kostenlos)',
    'openrouter/free':                   'Nexora Auto',
  };
  els.modelBadge.textContent = names[STATE.settings.model] || STATE.settings.model;
}

/* =============================================
   UTILITIES
   ============================================= */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); } catch {}
}

let toastTimeout;
function showToast(msg, type = '') {
  clearTimeout(toastTimeout);
  els.toast.textContent = msg;
  els.toast.className = `toast ${type}`;
  toastTimeout = setTimeout(() => { els.toast.className = 'toast hidden'; }, 2800);
}

function exportChat() {
  const chat = STATE.chats[STATE.activeChatId];
  if (!chat || chat.messages.length === 0) { showToast('Keine Nachrichten zum Exportieren.', ''); return; }
  let md = `# ${chat.title}\n\n*Exportiert am ${new Date().toLocaleString('de-DE')}*\n\n---\n\n`;
  for (const msg of chat.messages) {
    const role = msg.role === 'user' ? '**Du**' : '**Nexora**';
    md += `${role}:\n\n${msg.content}\n\n---\n\n`;
  }
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${chat.title.replace(/[^a-z0-9äöüß\s]/gi, '').slice(0, 40)}.md`;
  a.click();
  showToast('Chat als Markdown exportiert ✓', 'success');
}

/* =============================================
   EVENT LISTENERS
   ============================================= */

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    els.sidebar.classList.remove('open');
  }
}

function attachEvents() {
  // Sidebar
  els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('open'));
  if (els.mobileCloseSidebar) els.mobileCloseSidebar.addEventListener('click', () => els.sidebar.classList.remove('open'));
  if (els.sidebarOverlay) els.sidebarOverlay.addEventListener('click', () => els.sidebar.classList.remove('open'));
  els.newChatBtn.addEventListener('click', startNewChat);

  // Send
  els.sendBtn.addEventListener('click', sendMessage);
  els.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = els.userInput.selectionStart, end = els.userInput.selectionEnd;
      els.userInput.value = els.userInput.value.slice(0, s) + '  ' + els.userInput.value.slice(end);
      els.userInput.selectionStart = els.userInput.selectionEnd = s + 2;
    }
  });
  els.userInput.addEventListener('input', () => { autoResizeTextarea(); updateCharCounter(); });
  els.userInput.addEventListener('paste', () => setTimeout(() => { autoResizeTextarea(); updateCharCounter(); }, 0));

  // Code mode
  let codeModeActive = false;
  els.codeModeBtn.addEventListener('click', () => {
    codeModeActive = !codeModeActive;
    els.userInput.classList.toggle('code-mode', codeModeActive);
    els.codeModeBtn.classList.toggle('active', codeModeActive);
    showToast(codeModeActive ? 'Code-Modus aktiv' : 'Code-Modus deaktiviert', '');
  });

  // Model
  els.modelSelect.addEventListener('change', () => {
    STATE.settings.model = els.modelSelect.value;
    updateModelBadge();
    saveToStorage();
  });

  // Clear chat
  els.clearChatBtn.addEventListener('click', () => {
    if (!STATE.activeChatId) return;
    STATE.chats[STATE.activeChatId].messages = [];
    STATE.chats[STATE.activeChatId].title = 'Neuer Chat';
    els.chatTitle.textContent = 'Neuer Chat';
    renderMessages();
    renderChatList();
    saveToStorage();
    showToast('Chat geleert', '');
  });

  // Export
  els.exportBtn.addEventListener('click', exportChat);

  // Settings
  els.settingsBtn.addEventListener('click', openSettingsModal);
  els.closeSettings.addEventListener('click', closeSettingsModal);
  els.cancelSettings.addEventListener('click', closeSettingsModal);
  els.saveSettings.addEventListener('click', saveSettings);
  els.settingsModal.addEventListener('click', (e) => { if (e.target === els.settingsModal) closeSettingsModal(); });
  els.toggleKeyVis.addEventListener('click', () => {
    els.apiKeyInput.type = els.apiKeyInput.type === 'password' ? 'text' : 'password';
  });
  els.tempSlider.addEventListener('input', () => {
    els.tempValue.textContent = parseFloat(els.tempSlider.value).toFixed(2);
  });

  if (els.voiceLangSelect) {
    els.voiceLangSelect.addEventListener('change', populateVoiceOptions);
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = populateVoiceOptions;
  }

  // System prompt
  els.systemPromptBtn.addEventListener('click', () => {
    els.systemPromptQuick.value = STATE.settings.systemPrompt;
    els.systemPromptModal.classList.remove('hidden');
  });
  els.closeSystemPrompt.addEventListener('click', () => els.systemPromptModal.classList.add('hidden'));
  els.saveSystemPrompt.addEventListener('click', () => {
    STATE.settings.systemPrompt = els.systemPromptQuick.value;
    saveToStorage();
    els.systemPromptModal.classList.add('hidden');
    showToast('System-Prompt aktualisiert ✓', 'success');
  });
  els.systemPromptModal.addEventListener('click', (e) => {
    if (e.target === els.systemPromptModal) els.systemPromptModal.classList.add('hidden');
  });

  // Logout
  els.logoutBtn.addEventListener('click', async () => {
    await AUTH.logout();
    STATE.chats = {};
    STATE.activeChatId = null;
    els.app.classList.add('hidden');
    els.authScreen.classList.remove('hidden');
    showToast('Abgemeldet', '');
  });

  // Suggestion cards
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      els.userInput.value = card.dataset.prompt;
      autoResizeTextarea();
      updateCharCounter();
      els.userInput.focus();
    });
  });

  // Enter on auth inputs
  [$('login-password')].forEach(el => el?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));
  [$('reg-password2')].forEach(el => el?.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); }));

  // Nexora Upgrade events
  els.upgradeBtn.addEventListener('click', () => {
    els.subscriptionModal.classList.remove('hidden');
  });
  els.closeSubscription.addEventListener('click', () => {
    els.subscriptionModal.classList.add('hidden');
  });
  els.subscriptionModal.addEventListener('click', (e) => {
    if (e.target === els.subscriptionModal) els.subscriptionModal.classList.add('hidden');
  });
  document.querySelectorAll('.sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const plan = btn.dataset.plan;
      const price = btn.dataset.price;
      els.subscriptionModal.classList.add('hidden');
      showToast(`Demo-Modus: '${plan}' (${price}) ist in dieser Vorschau nicht kaufbar.`, 'error');
    });
  });

  // Feedback Channel event
  els.feedbackChannelBtn.addEventListener('click', switchToFeedbackChannel);

  // Feedback input events
  els.feedbackInput.addEventListener('input', () => {
    els.sendFeedbackBtn.disabled = !els.feedbackInput.value.trim();
  });
  els.feedbackInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFeedback();
    }
  });
  els.sendFeedbackBtn.addEventListener('click', sendFeedback);

  // Mode selector
  els.modeSelect.addEventListener('change', () => {
    switchMode(els.modeSelect.value);
  });

  // Theme toggle
  els.themeDarkBtn.addEventListener('click', () => setTheme('dark'));
  els.themeLightBtn.addEventListener('click', () => setTheme('light'));

  // Microphone / Voice Input
  if (els.micBtn) {
    els.micBtn.addEventListener('click', enterVoiceMode);
  }
  if (els.voiceCloseBtn) {
    els.voiceCloseBtn.addEventListener('click', exitVoiceMode);
  }
}

/* =============================================
   SHARED STATE (must be declared before init)
   ============================================= */

let isFeedbackActive = false;
let currentMode = 'general';
let speechRecognition = null;
let isRecording = false;

/* =============================================
   INIT
   ============================================= */

async function init() {
  attachEvents();
  initTheme();
  initMode();

  // Try to restore session (e.g. after page refresh or browser close)
  const hasSession = await AUTH.loadSession();
  if (hasSession) {
    showApp();
  }
  // Otherwise auth screen is shown by default (visible in HTML)
}



/* =============================================
   NEXORA UPGRADES (FEEDBACK & SUBSCRIPTION LOGIC)
   ============================================= */


/* =============================================
   MODE SYSTEM
   ============================================= */

const MODE_CONFIG = {
  general: {
    label: 'Standard-Assistent',
    systemPrompt: `Du bist Nexora, ein hochentwickelter und vielseitiger KI-Assistent auf Nexora-AI.com.

Deine Kernkompetenzen:
- Beantworte Fragen zu jedem Thema klar und verständlich
- Hilf bei Recherche, Zusammenfassungen und kreativen Aufgaben
- Nutze immer Markdown-Formatierung
- Sei präzise und hilfreich in deinen Antworten`,
    suggestions: [
      { icon: '⚡', label: 'Async/Await erklären', prompt: 'Erkläre mir Async/Await in JavaScript mit Beispielen.' },
      { icon: '🐍', label: 'Python API-Funktion', prompt: 'Schreibe mir eine Python-Funktion die eine REST API aufruft und die Antwort als JSON zurückgibt.' },
      { icon: '⚛️', label: 'React Custom Hook', prompt: 'Wie schreibe ich einen effizienten React Hook für Datenabruf mit Caching?' },
      { icon: '🐳', label: 'Docker Compose Setup', prompt: 'Erstelle mir eine vollständige Docker Compose Konfiguration für eine Node.js App mit PostgreSQL und Redis.' },
      { icon: '🔍', label: 'Code Review', prompt: 'Reviewed meinen Code und gib mir Verbesserungsvorschläge für Clean Code und Performance.' },
      { icon: '✅', label: 'Unit Tests schreiben', prompt: 'Schreibe unit tests für meine TypeScript-Funktionen mit Jest.' },
    ]
  },
  homework: {
    label: 'Hausaufgaben-Helfer',
    systemPrompt: `Du bist Nexora, ein freundlicher und geduldiger Hausaufgaben-Helfer auf Nexora-AI.com.

Deine Aufgabe:
- Hilf Schülern bei Hausaufgaben in allen Fächern (Mathe, Deutsch, Englisch, Geschichte, Biologie, Physik, Chemie usw.)
- Erkläre Konzepte Schritt für Schritt, damit der Schüler es wirklich versteht
- Gib NICHT einfach die fertige Antwort, sondern leite den Schüler zum Verständnis
- Verwende einfache Sprache und anschauliche Beispiele
- Nutze Markdown für Formeln und Strukturierung
- Motiviere und ermutige den Schüler`,
    suggestions: [
      { icon: '📐', label: 'Mathe: Bruchrechnen', prompt: 'Erkläre mir Schritt für Schritt wie Bruchrechnen funktioniert mit Beispielen.' },
      { icon: '📝', label: 'Deutsch: Aufsatz', prompt: 'Hilf mir einen Aufsatz über das Thema "Mein Lieblingsbuch" zu strukturieren.' },
      { icon: '🌍', label: 'Erdkunde: Klimazonen', prompt: 'Erkläre mir die verschiedenen Klimazonen der Erde mit ihren Merkmalen.' },
      { icon: '🔬', label: 'Biologie: Zelle', prompt: 'Beschreibe den Aufbau einer pflanzlichen Zelle und erkläre die Funktion jedes Teils.' },
      { icon: '📖', label: 'Geschichte: Antikes Rom', prompt: 'Fasse die wichtigsten Ereignisse des antiken Roms zusammen für meine Geschichtshausarbeit.' },
      { icon: '🇬🇧', label: 'Englisch: Grammatik', prompt: 'Erkläre mir den Unterschied zwischen Simple Past und Present Perfect mit Beispielen.' },
    ]
  },
  code: {
    label: 'Programmier-Modus',
    systemPrompt: `Du bist Nexora, ein Experten-Programmierer auf Nexora-AI.com.

Deine Kernkompetenzen:
- Schreibe sauberen, effizienten und gut dokumentierten Code
- Erkläre komplexe Programmierkonzepte verständlich mit Codebeispielen
- Führe Code-Reviews durch und identifiziere Bugs und Best-Practice-Verletzungen
- Hilf bei Systemarchitektur, Algorithmen und Datenstrukturen
- Unterstütze alle gängigen Programmiersprachen (JavaScript, Python, Java, C++, etc.)

Formatierungsregeln:
- Code IMMER in Codeblöcken mit korrektem Syntax-Highlighting
- Nutze Markdown für Strukturierung
- Sei präzise und technisch korrekt`,
    suggestions: [
      { icon: '💡', label: 'JavaScript Grundlagen', prompt: 'Erkläre mir die wichtigsten ES6+ Features in JavaScript mit Codebeispielen.' },
      { icon: '🏗️', label: 'REST API bauen', prompt: 'Zeige mir wie ich eine vollständige REST API mit Node.js und Express aufbaue.' },
      { icon: '🗃️', label: 'SQL Datenbank', prompt: 'Erstelle ein SQL-Datenbankschema für einen Online-Shop mit Produkten, Kunden und Bestellungen.' },
      { icon: '🐛', label: 'Debugging-Tipps', prompt: 'Was sind die besten Debugging-Strategien und Tools für JavaScript-Entwickler?' },
      { icon: '⚙️', label: 'Git Workflow', prompt: 'Erkläre mir einen professionellen Git-Workflow mit Branching-Strategie für Teams.' },
      { icon: '🚀', label: 'Performance-Optimierung', prompt: 'Welche Techniken gibt es um die Performance einer React-Anwendung zu optimieren?' },
    ]
  },
  teacher: {
    label: 'Lehrer-Assistent',
    systemPrompt: `Du bist Nexora, ein professioneller Lehrer-Assistent auf Nexora-AI.com.

Deine Aufgabe:
- Hilf Lehrkräften bei der Unterrichtsvorbereitung und Materialerstellung
- Erstelle Arbeitsblätter, Klausuren, Zusammenfassungen und Lehrpläne
- Generiere differenzierte Aufgaben für verschiedene Leistungsniveaus
- Formuliere Elternbriefe, Zeugniskommentare und Berichte
- Unterstütze bei der didaktischen Planung und Methodik
- Nutze eine professionelle, pädagogische Sprache
- Beachte den deutschen Lehrplan und Bildungsstandards`,
    suggestions: [
      { icon: '📋', label: 'Arbeitsblatt erstellen', prompt: 'Erstelle ein Arbeitsblatt zum Thema Bruchrechnen für die 6. Klasse mit 10 Aufgaben in aufsteigender Schwierigkeit.' },
      { icon: '📊', label: 'Klausur vorbereiten', prompt: 'Erstelle eine Deutsch-Klausur für die 10. Klasse zum Thema Erörterung mit Bewertungskriterien.' },
      { icon: '✉️', label: 'Elternbrief schreiben', prompt: 'Schreibe einen professionellen Elternbrief über einen bevorstehenden Schulausflug mit allen wichtigen Informationen.' },
      { icon: '📅', label: 'Unterrichtsplan', prompt: 'Erstelle einen detaillierten Unterrichtsplan für eine Doppelstunde Biologie zum Thema Fotosynthese.' },
      { icon: '💬', label: 'Zeugniskommentar', prompt: 'Formuliere 5 verschiedene positive Zeugniskommentare für Schüler mit unterschiedlichen Stärken.' },
      { icon: '🎯', label: 'Differenzierte Aufgaben', prompt: 'Erstelle zum Thema "Lineare Funktionen" differenzierte Aufgaben für drei Leistungsniveaus (Basis, Mittel, Experte).' },
    ]
  },
};

function switchMode(mode) {
  currentMode = mode;
  // Update body class for accent color
  document.body.classList.remove('mode-general', 'mode-homework', 'mode-code', 'mode-teacher');
  document.body.classList.add(`mode-${mode}`);
  // Update system prompt (only if not customized by user)
  const config = MODE_CONFIG[mode];
  STATE.settings.systemPrompt = config.systemPrompt;
  saveToStorage();
  // Update suggestion cards
  renderSuggestions(config.suggestions);
  // Save mode preference
  localStorage.setItem('nexora_mode', mode);
  // Update select
  els.modeSelect.value = mode;
  showToast(`Modus: ${config.label} aktiviert`, 'success');
}

function renderSuggestions(suggestions) {
  if (!els.suggestionsGrid) return;
  els.suggestionsGrid.innerHTML = '';
  suggestions.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'suggestion-card';
    btn.dataset.prompt = s.prompt;
    btn.innerHTML = `<span class="suggestion-icon">${s.icon}</span><span>${s.label}</span>`;
    btn.addEventListener('click', () => {
      els.userInput.value = s.prompt;
      autoResizeTextarea();
      updateCharCounter();
      els.userInput.focus();
    });
    els.suggestionsGrid.appendChild(btn);
  });
}

function initMode() {
  const saved = localStorage.getItem('nexora_mode') || 'general';
  currentMode = saved;
  document.body.classList.add(`mode-${saved}`);
  els.modeSelect.value = saved;
  const config = MODE_CONFIG[saved];
  if (config) {
    renderSuggestions(config.suggestions);
    // Set system prompt to mode default on init
    STATE.settings.systemPrompt = config.systemPrompt;
  }
}

/* =============================================
   THEME SYSTEM
   ============================================= */

function setTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  localStorage.setItem('nexora_theme', theme);
  updateThemeButtons(theme);
  showToast(theme === 'light' ? 'Helles Design aktiviert ☀️' : 'Dunkles Design aktiviert 🌙', 'success');
}

function updateThemeButtons(theme) {
  els.themeDarkBtn.classList.toggle('active', theme === 'dark');
  els.themeLightBtn.classList.toggle('active', theme === 'light');
}

function initTheme() {
  const saved = localStorage.getItem('nexora_theme') || 'dark';
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
  updateThemeButtons(saved);
}

function switchToFeedbackChannel() {
  isFeedbackActive = true;
  
  // Hide Chat Messages and normal Input Area
  els.messagesContainer.classList.add('hidden');
  document.querySelector('.input-area').classList.add('hidden');
  
  // Show Feedback Container
  els.feedbackContainer.classList.remove('hidden');
  
  // Update sidebar active classes
  els.feedbackChannelBtn.classList.add('active');
  document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
  
  // Update Header Title
  els.chatTitle.textContent = "Feedback-Kanal";
  els.modelBadge.textContent = "Nexora Community";
  
  // Load feedback from server
  loadFeedback();
}

async function loadFeedback() {
  try {
    const response = await fetch('/api/feedback');
    if (!response.ok) throw new Error('Failed to fetch feedback');
    const feedback = await response.json();
    renderFeedback(feedback);
  } catch (err) {
    console.error('Error loading feedback:', err);
    // Fallback loading from localStorage
    const offline = localStorage.getItem('offline_feedback');
    if (offline) {
      renderFeedback(JSON.parse(offline));
    } else {
      const defaults = [
        { id: "fb1", username: "Lehrerin_Sabine", avatar: "S", content: "Das Lehrer-Abo ist fantastisch! Endlich kann ich den Chatbot im Unterricht einsetzen.", timestamp: "Vor 2 Stunden", role: "Lehrkraft" },
        { id: "fb2", username: "Lukas_Dev", avatar: "L", content: "Die Integration der neuen kostenlosen Modelle ist genial. Design erinnert angenehm an ChatGPT!", timestamp: "Vor 4 Stunden", role: "Entwickler" }
      ];
      renderFeedback(defaults);
    }
  }
}

function renderFeedback(feedbacks) {
  els.feedbackMessages.innerHTML = '';
  feedbacks.forEach(fb => {
    const item = document.createElement('div');
    item.className = 'feedback-item';
    const roleClass = (fb.role || 'Gast').toLowerCase();
    item.innerHTML = `
      <div class="feedback-user-avatar">${escapeHtml(fb.avatar || fb.username[0])}</div>
      <div class="feedback-item-content">
        <div class="feedback-item-header">
          <span class="feedback-item-name">${escapeHtml(fb.username)}</span>
          <span class="feedback-item-role ${roleClass}">${escapeHtml(fb.role || 'Gast')}</span>
          <span class="feedback-item-time">${escapeHtml(fb.timestamp)}</span>
        </div>
        <div class="feedback-item-text">${escapeHtml(fb.content)}</div>
      </div>
    `;
    els.feedbackMessages.appendChild(item);
  });
  els.feedbackMessages.scrollTop = els.feedbackMessages.scrollHeight;
}

async function sendFeedback() {
  const username = els.feedbackUsername.value.trim() || 'Gast';
  const role = els.feedbackRole.value;
  const content = els.feedbackInput.value.trim();
  if (!content) return;

  els.sendFeedbackBtn.disabled = true;
  els.feedbackInput.disabled = true;

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, role, content })
    });
    if (!response.ok) throw new Error('Failed to post feedback');
    
    await loadFeedback();
    els.feedbackInput.value = '';
    showToast('Feedback gesendet! ✓', 'success');

    // Simulate reply after 1.5s
    setTimeout(async () => {
      await simulateReply(username);
    }, 1500);

  } catch (err) {
    console.error('Error posting feedback, saving locally:', err);
    const offline = JSON.parse(localStorage.getItem('offline_feedback') || '[]');
    const newFb = {
      id: 'fb_' + Date.now(),
      username,
      avatar: username[0].toUpperCase(),
      content,
      timestamp: 'Gerade eben',
      role
    };
    offline.push(newFb);
    localStorage.setItem('offline_feedback', JSON.stringify(offline));
    renderFeedback(offline);
    els.feedbackInput.value = '';
    showToast('Feedback lokal gespeichert ✓', 'success');
  } finally {
    els.sendFeedbackBtn.disabled = true;
    els.feedbackInput.disabled = false;
    els.feedbackInput.focus();
  }
}

async function simulateReply(userTarget) {
  const replies = [
    `Cooler Beitrag, ${userTarget}! Finde Nexora AI auch echt gelungen.`,
    `Das sehe ich genauso. Vor allem das neue Design wie ChatGPT gefällt mir deutlich besser!`,
    `Stimmt, die Apple-style Animationen machen das ganze viel lebendiger.`,
    `Gibt es eigentlich Pläne für eine Mobile App? Das wäre super für unterwegs!`,
    `Ich nutze Nexora AI jetzt seit ein paar Tagen und bin echt begeistert von der Stabilität.`
  ];
  const botUsers = [
    { name: "Jonas_B", role: "Schüler", avatar: "J" },
    { name: "Anna_M", role: "Lehrkraft", avatar: "A" },
    { name: "Kevin_Dev", role: "Entwickler", avatar: "K" },
    { name: "Marie_L", role: "Gast", avatar: "M" }
  ];
  const randomUser = botUsers[Math.floor(Math.random() * botUsers.length)];
  const randomText = replies[Math.floor(Math.random() * replies.length)];

  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: randomUser.name,
        role: randomUser.role,
        content: randomText,
        avatar: randomUser.avatar
      })
    });
    // If the feedback view is still open, reload the messages
    if (isFeedbackActive) {
      await loadFeedback();
    }
  } catch (e) {
    console.warn('Simulation failed offline:', e);
  }
}

/* =============================================
   VOICE INPUT (Speech-to-Text)
   ============================================= */

function toggleVoiceInput() {
  if (isRecording) {
    stopVoiceInput();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Spracherkennung wird von deinem Browser nicht unterstützt. Nutze Chrome oder Edge.', 'error');
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'de-DE';
  speechRecognition.interimResults = true;
  speechRecognition.continuous = true;
  speechRecognition.maxAlternatives = 1;

  let finalTranscript = els.userInput.value;

  speechRecognition.onstart = () => {
    isRecording = true;
    els.micBtn.classList.add('recording');
    els.micBtn.title = 'Aufnahme stoppen';
    showToast('🎙️ Spracherkennung aktiv – sprich jetzt...', 'success');
  };

  speechRecognition.onresult = (event) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += (finalTranscript ? ' ' : '') + transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    els.userInput.value = finalTranscript + (interimTranscript ? ' ' + interimTranscript : '');
    autoResizeTextarea();
    updateCharCounter();
  };

  speechRecognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      showToast('Mikrofonzugriff verweigert. Bitte erlaube den Zugriff in deinen Browsereinstellungen.', 'error');
    } else if (event.error === 'no-speech') {
      showToast('Keine Sprache erkannt. Versuche es erneut.', '');
    } else {
      showToast('Spracherkennungsfehler: ' + event.error, 'error');
    }
    stopVoiceInput();
  };

  speechRecognition.onend = () => {
    stopVoiceInput();
  };

  try {
    speechRecognition.start();
  } catch (e) {
    console.error('Failed to start speech recognition:', e);
    showToast('Fehler beim Starten der Spracherkennung.', 'error');
  }
}

function stopVoiceInput() {
  isRecording = false;
  if (els.micBtn) {
    els.micBtn.classList.remove('recording');
    els.micBtn.title = 'Spracheingabe (Mikrofon)';
  }
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch {}
    speechRecognition = null;
  }
}

/* =============================================
   FULL SCREEN VOICE MODE
   ============================================= */

let voiceModeRecognition = null;
let isVoiceRecording = false;
let microphoneStream = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let voiceAnimationFrame = null;
let thinkingPulseInterval = null;
let aiVoiceInterval = null;

let spokenIndex = 0;
let sentenceQueue = [];
let voiceTextBuffer = '';

function enterVoiceMode() {
  if (STATE.isStreaming) {
    showToast('Bitte warte, bis die KI fertig geantwortet hat.', 'error');
    return;
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Spracherkennung wird von deinem Browser nicht unterstützt. Nutze Chrome oder Edge.', 'error');
    return;
  }

  STATE.voiceModeActive = true;
  
  // Hide scrollbar on body
  document.body.style.overflow = 'hidden';
  
  els.voiceOverlay.classList.remove('hidden');
  els.voiceStatus.textContent = 'Bereit...';
  els.voiceTranscript.textContent = 'Sprich jetzt...';
  els.voiceResponse.textContent = '';
  
  startVoiceRecognitionInVoiceMode();
}

function exitVoiceMode() {
  STATE.voiceModeActive = false;
  document.body.style.overflow = '';
  
  if (voiceModeRecognition) {
    try { voiceModeRecognition.stop(); } catch {}
    voiceModeRecognition = null;
  }
  
  isVoiceRecording = false;
  
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  
  stopMicrophoneVisualizer();
  stopThinkingPulseAnimation();
  stopAIVoiceAnimation();
  
  els.voiceOverlay.classList.add('hidden');
  
  setInputEnabled(true);
}

async function startVoiceRecognitionInVoiceMode() {
  if (!STATE.voiceModeActive) return;
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  voiceModeRecognition = new SpeechRecognition();
  voiceModeRecognition.lang = STATE.settings.voiceLanguage || 'de-DE';
  voiceModeRecognition.interimResults = true;
  voiceModeRecognition.continuous = false;
  
  let finalTranscript = '';
  
  voiceModeRecognition.onstart = () => {
    isVoiceRecording = true;
    els.voiceStatus.textContent = 'Nexora hört zu...';
    els.voiceStatus.style.color = '#10b981';
    els.voiceTranscript.textContent = 'Höre zu...';
    
    startMicrophoneVisualizer();
  };
  
  voiceModeRecognition.onresult = (event) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    els.voiceTranscript.textContent = finalTranscript || interimTranscript || 'Höre zu...';
  };
  
  voiceModeRecognition.onerror = (event) => {
    console.error('Voice recognition error:', event.error);
    if (event.error === 'not-allowed') {
      showToast('Mikrofonzugriff verweigert.', 'error');
      exitVoiceMode();
    } else {
      restartListeningWithDelay();
    }
  };
  
  voiceModeRecognition.onend = () => {
    isVoiceRecording = false;
    stopMicrophoneVisualizer();
    
    const text = finalTranscript.trim();
    if (text.length > 0) {
      submitVoiceMessage(text);
    } else {
      if (STATE.voiceModeActive && !window.speechSynthesis.speaking && !STATE.isStreaming) {
        restartListeningWithDelay();
      }
    }
  };
  
  try {
    voiceModeRecognition.start();
  } catch (e) {
    console.error('Failed to start speech recognition:', e);
  }
}

function restartListeningWithDelay() {
  if (!STATE.voiceModeActive || window.speechSynthesis.speaking || STATE.isStreaming) return;
  els.voiceStatus.textContent = 'Warte auf Sprache...';
  els.voiceStatus.style.color = 'rgba(255, 255, 255, 0.45)';
  setTimeout(() => {
    if (STATE.voiceModeActive && !window.speechSynthesis.speaking && !STATE.isStreaming && !isVoiceRecording) {
      startVoiceRecognitionInVoiceMode();
    }
  }, 1000);
}

async function submitVoiceMessage(text) {
  if (STATE.isStreaming) return;
  
  if (!STATE.settings.apiKey) {
    showToast('Bitte gib deinen Nexora API Key in den Einstellungen ein.', 'error');
    exitVoiceMode();
    openSettingsModal();
    return;
  }
  
  STATE.isStreaming = true;
  els.voiceStatus.textContent = 'Nexora denkt nach...';
  els.voiceStatus.style.color = '#10b981';
  els.voiceResponse.textContent = '';
  
  startThinkingPulseAnimation();
  
  const chat = STATE.chats[STATE.activeChatId];
  if (chat) {
    if (chat.messages.length === 0) updateChatTitle(STATE.activeChatId, text);
    chat.messages.push({ role: 'user', content: text });
    appendMessageToDOM('user', text);
    saveToStorage();
  }
  
  let fullResponse = '';
  const streamEl = createStreamingMessage();
  
  resetVoiceSpeech();
  
  try {
    const messages = [];
    if (STATE.settings.systemPrompt.trim()) {
      messages.push({ role: 'system', content: STATE.settings.systemPrompt.trim() });
    }
    if (chat) {
      chat.messages.forEach(m => messages.push({ role: m.role, content: m.content }));
    }
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.settings.apiKey}`,
        'HTTP-Referer': 'https://nexora-ai-app',
        'X-Title': 'Nexora AI App',
      },
      body: JSON.stringify({
        model: STATE.settings.model,
        max_tokens: STATE.settings.maxTokens,
        temperature: STATE.settings.temperature,
        stream: true,
        messages,
      }),
    });
    
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    stopThinkingPulseAnimation();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const evt = JSON.parse(jsonStr);
          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta;
            updateStreamingMessage(streamEl, fullResponse);
            processIncomingStreamForVoice(fullResponse);
          }
        } catch {}
      }
    }
    
    finalizeStreamingMessage(streamEl, fullResponse);
    if (chat) {
      chat.messages.push({ role: 'assistant', content: fullResponse });
      saveToStorage();
    }
    
    finalizeVoiceSpeech(fullResponse);
    
  } catch (err) {
    console.error('Voice stream error:', err);
    showToast('Fehler: ' + err.message, 'error');
    exitVoiceMode();
  } finally {
    STATE.isStreaming = false;
    setInputEnabled(true);
  }
}

function resetVoiceSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  spokenIndex = 0;
  sentenceQueue = [];
  voiceTextBuffer = '';
}

function processIncomingStreamForVoice(text) {
  if (!STATE.voiceModeActive) return;
  
  els.voiceResponse.textContent = text;
  
  const rawNew = text.slice(voiceTextBuffer.length);
  voiceTextBuffer = text;
  
  let lastIndex = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '.' || char === '?' || char === '!' || char === '\n') {
      const sentence = text.slice(lastIndex, i + 1).trim();
      if (sentence.length > 3) {
        if (!sentenceQueue.includes(sentence)) {
          sentenceQueue.push(sentence);
          playNextSentence();
        }
      }
      lastIndex = i + 1;
    }
  }
}

function playNextSentence() {
  if (!STATE.voiceModeActive) return;
  if (!('speechSynthesis' in window)) return;
  if (window.speechSynthesis.speaking) return;
  if (spokenIndex >= sentenceQueue.length) return;
  
  const sentence = sentenceQueue[spokenIndex];
  spokenIndex++;
  
  const utterance = new SpeechSynthesisUtterance(sentence);
  const lang = STATE.settings.voiceLanguage || 'de-DE';
  utterance.lang = lang;
  
  const voices = window.speechSynthesis.getVoices();
  const prefVoiceName = STATE.settings.voiceVoice;
  
  let selectedVoice = null;
  if (prefVoiceName && prefVoiceName !== 'auto') {
    selectedVoice = voices.find(v => v.name === prefVoiceName);
  }
  
  if (!selectedVoice) {
    const langPrefix = lang.split('-')[0];
    selectedVoice = voices.find(v => v.lang.startsWith(langPrefix) && v.name.includes('Google')) ||
                    voices.find(v => v.lang.startsWith(langPrefix)) ||
                    voices[0];
  }
  if (selectedVoice) utterance.voice = selectedVoice;
  
  utterance.onstart = () => {
    els.voiceStatus.textContent = 'Nexora spricht...';
    els.voiceStatus.style.color = '#10b981';
    startAIVoiceAnimation();
  };
  
  utterance.onend = () => {
    stopAIVoiceAnimation();
    if (spokenIndex < sentenceQueue.length) {
      playNextSentence();
    } else {
      if (!STATE.isStreaming) {
        els.voiceStatus.textContent = 'Bereit...';
        els.voiceStatus.style.color = 'rgba(255, 255, 255, 0.45)';
        setTimeout(() => {
          if (STATE.voiceModeActive && !window.speechSynthesis.speaking && !isVoiceRecording) {
            startVoiceRecognitionInVoiceMode();
          }
        }, 500);
      }
    }
  };
  
  utterance.onerror = () => {
    stopAIVoiceAnimation();
    if (spokenIndex < sentenceQueue.length) {
      playNextSentence();
    }
  };
  
  window.speechSynthesis.speak(utterance);
}

function finalizeVoiceSpeech(fullText) {
  if (!STATE.voiceModeActive) return;
  
  const lastPart = fullText.slice(sentenceQueue.join(' ').length).trim();
  if (lastPart.length > 0 && !sentenceQueue.includes(lastPart)) {
    sentenceQueue.push(lastPart);
  }
  
  playNextSentence();
  
  if (sentenceQueue.length === 0 || spokenIndex >= sentenceQueue.length) {
    els.voiceStatus.textContent = 'Bereit...';
    els.voiceStatus.style.color = 'rgba(255, 255, 255, 0.45)';
    setTimeout(() => {
      if (STATE.voiceModeActive && !window.speechSynthesis.speaking && !isVoiceRecording) {
        startVoiceRecognitionInVoiceMode();
      }
    }, 500);
  }
}

async function startMicrophoneVisualizer() {
  stopMicrophoneVisualizer();
  
  const bars = document.querySelectorAll('.voice-bar');
  bars.forEach(bar => {
    bar.style.backgroundColor = 'white';
    bar.style.boxShadow = '0 0 24px rgba(255, 255, 255, 0.2)';
  });
  
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Auto-resume AudioContext if suspended (browser security policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    analyser = audioContext.createAnalyser();
    source = audioContext.createMediaStreamSource(microphoneStream);
    source.connect(analyser);
    
    analyser.fftSize = 256; // larger buffer for stable time-domain signal
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    
    function draw() {
      if (!isVoiceRecording || !STATE.voiceModeActive) {
        stopMicrophoneVisualizer();
        return;
      }
      
      analyser.getByteTimeDomainData(dataArray);
      
      // Calculate Root-Mean-Square (RMS) loudness volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = (dataArray[i] - 128) / 128; // Normalize to -1..1 range
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bufferLength);
      
      // Map loudness to bar heights with different multipliers for organic wave look
      const multipliers = [0.7, 1.4, 1.4, 0.7];
      for (let i = 0; i < 4; i++) {
        const vol = rms * multipliers[i] * 6.5; // Amplification factor
        const height = 24 + Math.min(116, vol * 116);
        if (bars[i]) {
          bars[i].style.height = `${height}px`;
        }
      }
      
      voiceAnimationFrame = requestAnimationFrame(draw);
    }
    
    draw();
  } catch (err) {
    console.warn('Microphone visualizer error, using simulation:', err);
    let t = 0;
    function simulate() {
      if (!isVoiceRecording || !STATE.voiceModeActive) return;
      bars.forEach((bar, i) => {
        const amp = 24 + Math.sin(t + i) * 15 + Math.random() * 25;
        bar.style.height = `${Math.max(24, Math.min(80, amp))}px`;
      });
      t += 0.3;
      voiceAnimationFrame = requestAnimationFrame(simulate);
    }
    simulate();
  }
}

function stopMicrophoneVisualizer() {
  if (voiceAnimationFrame) {
    cancelAnimationFrame(voiceAnimationFrame);
    voiceAnimationFrame = null;
  }
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch {}
    audioContext = null;
  }
  const bars = document.querySelectorAll('.voice-bar');
  bars.forEach(bar => {
    bar.style.height = '24px';
  });
}

function startThinkingPulseAnimation() {
  stopThinkingPulseAnimation();
  const bars = document.querySelectorAll('.voice-bar');
  
  bars.forEach(bar => {
    bar.style.backgroundColor = '#10b981';
    bar.style.boxShadow = '0 0 24px rgba(16, 185, 129, 0.4)';
  });
  
  let t = 0;
  function pulse() {
    bars.forEach((bar, i) => {
      const scale = 24 + Math.sin(t + i * 0.8) * 30;
      bar.style.height = `${scale}px`;
    });
    t += 0.15;
    thinkingPulseInterval = requestAnimationFrame(pulse);
  }
  
  pulse();
}

function stopThinkingPulseAnimation() {
  if (thinkingPulseInterval) {
    cancelAnimationFrame(thinkingPulseInterval);
    thinkingPulseInterval = null;
  }
  const bars = document.querySelectorAll('.voice-bar');
  bars.forEach(bar => {
    bar.style.height = '24px';
    bar.style.backgroundColor = 'white';
    bar.style.boxShadow = '0 0 24px rgba(255, 255, 255, 0.2)';
  });
}

function startAIVoiceAnimation() {
  stopAIVoiceAnimation();
  const bars = document.querySelectorAll('.voice-bar');
  
  bars.forEach(bar => {
    bar.style.backgroundColor = '#10b981';
    bar.style.boxShadow = '0 0 24px rgba(16, 185, 129, 0.4)';
  });
  
  let t = 0;
  function animate() {
    if (!window.speechSynthesis.speaking) {
      stopAIVoiceAnimation();
      return;
    }
    
    bars.forEach((bar, i) => {
      const phase = i * 1.5;
      const amp = 30 + Math.sin(t + phase) * 50 + Math.random() * 40;
      bar.style.height = `${Math.max(24, Math.min(140, amp))}px`;
    });
    
    t += 0.2;
    aiVoiceInterval = requestAnimationFrame(animate);
  }
  
  animate();
}

function stopAIVoiceAnimation() {
  if (aiVoiceInterval) {
    cancelAnimationFrame(aiVoiceInterval);
    aiVoiceInterval = null;
  }
  const bars = document.querySelectorAll('.voice-bar');
  bars.forEach(bar => {
    bar.style.height = '24px';
    bar.style.backgroundColor = 'white';
    bar.style.boxShadow = '0 0 24px rgba(255, 255, 255, 0.2)';
  });
}

// Start application
init();
