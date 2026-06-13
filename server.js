const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// =============================================
//   JSON DATABASE (No SQLite needed for Render)
// =============================================

const DB_FILE = path.join(__dirname, 'database.json');
let db = { feedback: [], users: [], sessions: [], api_keys: [], admin_sessions: [], chat_histories: [] };

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('❌ Fehler beim Laden der Datenbank:', e.message);
    }
  } else {
    // Migrate old feedback.json if it exists
    const oldFeedbackFile = path.join(__dirname, 'feedback.json');
    if (fs.existsSync(oldFeedbackFile)) {
      try {
        db.feedback = JSON.parse(fs.readFileSync(oldFeedbackFile, 'utf8') || '[]');
        fs.renameSync(oldFeedbackFile, oldFeedbackFile + '.bak');
      } catch (e) {}
    }
    saveDB();
  }
}
loadDB();

// Ensure db has new fields after migration
if (!db.api_keys) db.api_keys = [];
if (!db.admin_sessions) db.admin_sessions = [];
if (!db.chat_histories) db.chat_histories = [];
saveDB();

// =============================================
//   ADMIN CONFIG
// =============================================

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Sagvan/admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Nexora2026';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin-Authentifizierung erforderlich' });
  }
  const token = authHeader.split(' ')[1];
  const session = db.admin_sessions.find(s => s.token === token);
  if (!session) {
    return res.status(401).json({ error: 'Ungültiger Admin-Token' });
  }
  next();
}

// Benutzer-Authentifizierung Middleware
function userAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentifizierung erforderlich. Bitte melde dich an.' });
  }
  const token = authHeader.split(' ')[1];
  const session = db.sessions.find(s => s.token === token);
  if (!session) return res.status(401).json({ error: 'Ungültige oder abgelaufene Session.' });
  // Session-Ablauf: 7 Tage
  if (Date.now() - session.created_at > 7 * 24 * 60 * 60 * 1000) {
    db.sessions = db.sessions.filter(s => s.token !== token);
    saveDB();
    return res.status(401).json({ error: 'Session abgelaufen. Bitte erneut anmelden.' });
  }
  const user = db.users.find(u => u.id === session.user_id);
  if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden.' });
  req.user = user;
  next();
}

// =============================================
//   PASSWORD HASHING (Node.js crypto scrypt)
// =============================================

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt + ':' + derivedKey.toString('hex'));
    });
  });
}

function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex') === key);
    });
  });
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// IP-basiertes Rate Limiting
const ipRateLimits = {};
function checkIPRateLimit(ip, action, maxAttempts, windowMs) {
  const key = `${ip}:${action}`;
  const now = Date.now();
  if (!ipRateLimits[key]) ipRateLimits[key] = [];
  ipRateLimits[key] = ipRateLimits[key].filter(t => now - t < windowMs);
  if (ipRateLimits[key].length >= maxAttempts) return false;
  ipRateLimits[key].push(now);
  return true;
}
// Alte Einträge alle 10 Minuten bereinigen
setInterval(() => {
  const now = Date.now();
  for (const key in ipRateLimits) {
    ipRateLimits[key] = ipRateLimits[key].filter(t => now - t < 3600000);
    if (ipRateLimits[key].length === 0) delete ipRateLimits[key];
  }
}, 600000);

// =============================================
//   AUTH API ROUTES
// =============================================

app.post('/api/auth/register', async (req, res) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!checkIPRateLimit(clientIP, 'register', 5, 3600000)) {
    return res.status(429).json({ error: 'Zu viele Registrierungen. Bitte warte eine Stunde.' });
  }

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich.' });
  if (email.trim().length < 2) return res.status(400).json({ error: 'E-Mail-Adresse ist zu kurz.' });
  if (password.length < 4) return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen haben.' });

  const existingUser = db.users.find(u => u.email === email.trim() || u.username === email.trim());
  if (existingUser) return res.status(409).json({ error: 'E-Mail bereits vergeben.' });

  try {
    const passwordHash = await hashPassword(password);
    const user = {
      id: Date.now().toString() + Math.floor(Math.random()*1000),
      email: email.trim(),
      username: email.trim(),
      password_hash: passwordHash,
      created_at: Date.now()
    };
    db.users.push(user);

    // Automatisch kostenlosen API-Key generieren
    const autoKey = {
      id: 'key_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      user_id: user.id,
      label: 'Free-Tier Auto-Key',
      key: 'nxr-free-' + crypto.randomBytes(24).toString('hex'),
      tier: 'free',
      active: true,
      balance: 1000,
      created_at: Date.now(),
    };
    db.api_keys.push(autoKey);

    const token = generateToken();
    db.sessions.push({ token, user_id: user.id, created_at: Date.now() });
    saveDB();

    console.log(`✅ Neuer User registriert: ${user.email}`);
    res.status(201).json({ token, email: user.email, apiKey: autoKey.key, tier: autoKey.tier });
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler bei der Registrierung.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich.' });

  const user = db.users.find(u => u.email === email.trim() || u.username === email.trim());
  if (!user) return res.status(401).json({ error: 'E-Mail nicht gefunden.' });

  try {
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Falsches Passwort.' });

    const token = generateToken();
    db.sessions.push({ token, user_id: user.id, created_at: Date.now() });
    saveDB();

    console.log(`🔓 User eingeloggt: ${user.email || user.username}`);
    res.json({ token, email: user.email || user.username });
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler beim Login.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht authentifiziert' });
  const token = authHeader.split(' ')[1];

  const session = db.sessions.find(s => s.token === token);
  if (!session) return res.status(401).json({ error: 'Ungültige oder abgelaufene Session' });

  const user = db.users.find(u => u.id === session.user_id);
  if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });

  res.json({ email: user.email || user.username });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    db.sessions = db.sessions.filter(s => s.token !== token);
    saveDB();
  }
  res.json({ ok: true });
});

// =============================================
//   USER API-KEY & USAGE ENDPOINT
// =============================================

app.get('/api/user/api-key', userAuth, (req, res) => {
  const key = db.api_keys.find(k => k.user_id === req.user.id && k.active);
  if (!key) return res.status(404).json({ error: 'Kein API-Key gefunden. Bitte kontaktiere den Support.' });
  res.json({
    key: key.key,
    tier: key.tier || 'free',
    balance: key.balance || 0,
    active: key.active,
  });
});

// =============================================
//   FEEDBACK API
// =============================================

app.get('/api/feedback', (req, res) => {
  const sorted = [...db.feedback].sort((a, b) => b.created_at - a.created_at);
  res.json(sorted);
});

app.post('/api/feedback', (req, res) => {
  const { username, avatar, content, role, timestamp } = req.body;
  if (!username || !content) return res.status(400).json({ error: 'Ungültige Daten' });

  const newFeedback = {
    id: 'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username,
    avatar: avatar || username.charAt(0).toUpperCase(),
    content,
    role: role || 'Gast',
    timestamp: timestamp || 'Gerade eben',
    created_at: Date.now()
  };

  db.feedback.push(newFeedback);
  saveDB();
  res.status(201).json({ success: true, message: 'Gespeichert' });
});

// =============================================
//   AI PROXY ROUTE
// =============================================

app.post('/api/chat/completions', userAuth, async (req, res) => {
  try {
    // Rate Limiting & Zugriffskontrolle
    const userKey = db.api_keys.find(k => k.user_id === req.user.id && k.active);
    if (!userKey) {
      return res.status(403).json({ error: { message: 'Kein aktiver API-Key. Bitte kontaktiere den Support.' } });
    }

    if ((userKey.balance || 0) <= 0) {
      return res.status(402).json({ error: { message: 'Unzureichendes Guthaben. Bitte laden Sie Ihr Konto auf.' } });
    }

    // Modellzugriff prüfen
    const freeModels = [
      'google/gemma-4-26b-a4b-it:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-v4-flash:free',
      'qwen/qwen3-coder:free',
      'openrouter/free',
    ];
    const requestedModel = req.body.model || '';
    if (userKey.tier === 'free' && !freeModels.includes(requestedModel)) {
      return res.status(403).json({ error: { message: 'Dieses Modell ist nur für Premium-User verfügbar. Upgrade dein Abo!' } });
    }

    const inputChars = JSON.stringify(req.body.messages || []).length;
    const estimatedCost = Math.ceil(inputChars / 100);
    userKey.balance = (userKey.balance || 0) - estimatedCost;
    saveDB();

    const apiKeyToUse = OPENROUTER_API_KEY;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeyToUse}`,
        'HTTP-Referer': 'https://nexora-ai-app',
        'X-Title': 'Nexora AI App',
      },
      body: JSON.stringify(req.body)
    });

    res.status(response.status);
    response.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      res.end();
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: { message: 'Proxy-Fehler zum KI-Anbieter' } });
  }
});

// =============================================
//   ADMIN API ROUTES
// =============================================

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Falscher Benutzername oder Passwort.' });
  }
  const token = generateToken();
  db.admin_sessions.push({ token, created_at: Date.now() });
  saveDB();
  console.log('\u{1F510} Admin eingeloggt');
  res.json({ token });
});

app.post('/api/admin/logout', adminAuth, (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  db.admin_sessions = db.admin_sessions.filter(s => s.token !== token);
  saveDB();
  res.json({ ok: true });
});

app.get('/api/admin/dashboard', adminAuth, (req, res) => {
  res.json({
    users: db.users.length,
    sessions: db.sessions.length,
    feedback: db.feedback.length,
    api_keys: db.api_keys.length,
    chats: db.chat_histories.length,
  });
});

// --- Users ---
app.get('/api/admin/users', adminAuth, (req, res) => {
  const users = db.users.map(u => {
    const key = db.api_keys.find(k => k.user_id === u.id && k.active);
    return {
      id: u.id,
      username: u.username || u.email,
      email: u.email,
      tier: key ? (key.tier || 'free') : 'none',
      balance: key ? (key.balance || 0) : 0,
      api_key: key ? key.key : null,
      created_at: u.created_at,
    };
  });
  res.json(users);
});

app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  db.users = db.users.filter(u => u.id !== id);
  db.sessions = db.sessions.filter(s => s.user_id !== id);
  db.chat_histories = db.chat_histories.filter(c => c.user_id !== id);
  db.api_keys = db.api_keys.filter(k => k.user_id !== id);
  saveDB();
  console.log(`\u{1F5D1} User gelöscht: ${id}`);
  res.json({ ok: true });
});

// --- API Keys ---
app.get('/api/admin/api-keys', adminAuth, (req, res) => {
  const keys = db.api_keys.map(k => {
    const user = db.users.find(u => u.id === k.user_id);
    return { ...k, username: user ? user.username : (k.user_id === 'global' ? 'Global' : 'Unbekannt') };
  });
  res.json(keys);
});

app.post('/api/admin/api-keys', adminAuth, (req, res) => {
  const { user_id, label } = req.body;
  const key = {
    id: 'key_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    user_id: user_id || 'global',
    label: label || 'API Key',
    key: 'nxr-' + crypto.randomBytes(32).toString('hex'),
    active: true,
    balance: 1000,
    created_at: Date.now(),
  };
  db.api_keys.push(key);
  saveDB();
  console.log(`Neuer API-Key erstellt: ${key.id}`);
  res.status(201).json(key);
});

app.delete('/api/admin/api-keys/:id', adminAuth, (req, res) => {
  db.api_keys = db.api_keys.filter(k => k.id !== req.params.id);
  saveDB();
  res.json({ ok: true });
});

app.patch('/api/admin/api-keys/:id', adminAuth, (req, res) => {
  const key = db.api_keys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'Key nicht gefunden' });
  key.active = !key.active;
  saveDB();
  res.json(key);
});

// --- User Tier Verwaltung ---
app.patch('/api/admin/users/:id/tier', adminAuth, (req, res) => {
  const { tier } = req.body;
  if (!['free', 'basic', 'pro'].includes(tier)) {
    return res.status(400).json({ error: 'Ungültiger Tier. Erlaubt: free, basic, pro' });
  }
  const userKey = db.api_keys.find(k => k.user_id === req.params.id && k.active);
  if (!userKey) {
    return res.status(404).json({ error: 'Kein API-Key für diesen User gefunden.' });
  }
  userKey.tier = tier;
  saveDB();
  const user = db.users.find(u => u.id === req.params.id);
  console.log(`User ${user ? user.email : req.params.id} -> Tier: ${tier}`);
  res.json({ ok: true, tier });
});

app.patch('/api/admin/users/:id/balance', adminAuth, (req, res) => {
  const { balance } = req.body;
  if (typeof balance !== 'number') {
    return res.status(400).json({ error: 'Guthaben muss eine Zahl sein.' });
  }
  const userKey = db.api_keys.find(k => k.user_id === req.params.id && k.active);
  if (!userKey) {
    return res.status(404).json({ error: 'Kein API-Key für diesen User gefunden.' });
  }
  userKey.balance = balance;
  saveDB();
  const user = db.users.find(u => u.id === req.params.id);
  console.log(`User ${user ? user.email : req.params.id} -> Guthaben: ${balance}`);
  res.json({ ok: true, balance: userKey.balance });
});

// --- Feedback (admin) ---
app.get('/api/admin/feedback', adminAuth, (req, res) => {
  const sorted = [...db.feedback].sort((a, b) => b.created_at - a.created_at);
  res.json(sorted);
});

app.delete('/api/admin/feedback/:id', adminAuth, (req, res) => {
  db.feedback = db.feedback.filter(f => f.id !== req.params.id);
  saveDB();
  res.json({ ok: true });
});

// --- Sessions (admin) ---
app.get('/api/admin/sessions', adminAuth, (req, res) => {
  const sessions = db.sessions.map(s => {
    const user = db.users.find(u => u.id === s.user_id);
    return { ...s, username: user ? user.username : 'Unbekannt' };
  });
  res.json(sessions);
});

app.delete('/api/admin/sessions/:token', adminAuth, (req, res) => {
  db.sessions = db.sessions.filter(s => s.token !== req.params.token);
  saveDB();
  res.json({ ok: true });
});

// --- Chat Histories (admin) ---
app.get('/api/admin/chats', adminAuth, (req, res) => {
  const chats = db.chat_histories.map(c => {
    const user = db.users.find(u => u.id === c.user_id);
    return {
      id: c.id,
      user_id: c.user_id,
      username: user ? user.username : (c.guest_name || 'Gast'),
      title: c.title,
      message_count: c.messages ? c.messages.length : 0,
      created_at: c.created_at,
      updated_at: c.updated_at,
    };
  });
  res.json(chats.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)));
});

app.get('/api/admin/chats/:id', adminAuth, (req, res) => {
  const chat = db.chat_histories.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat nicht gefunden' });
  const user = db.users.find(u => u.id === chat.user_id);
  res.json({ ...chat, username: user ? user.username : (chat.guest_name || 'Gast') });
});

app.delete('/api/admin/chats/:id', adminAuth, (req, res) => {
  db.chat_histories = db.chat_histories.filter(c => c.id !== req.params.id);
  saveDB();
  res.json({ ok: true });
});

// =============================================
//   USER CHAT SYNC API
// =============================================

app.post('/api/chats', (req, res) => {
  const { chat_id, title, messages, guest_name } = req.body;
  if (!chat_id) return res.status(400).json({ error: 'chat_id erforderlich' });

  let user_id = null;
  let username = guest_name || 'Gast';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const session = db.sessions.find(s => s.token === token);
    if (session) {
      user_id = session.user_id;
      const user = db.users.find(u => u.id === user_id);
      if (user) username = user.username;
    }
  }

  const existing = db.chat_histories.find(c => c.id === chat_id);
  if (existing) {
    existing.title = title || existing.title;
    existing.messages = messages || existing.messages;
    existing.updated_at = Date.now();
    if (user_id) existing.user_id = user_id;
  } else {
    db.chat_histories.push({
      id: chat_id,
      user_id,
      guest_name: !user_id ? username : undefined,
      title: title || 'Neuer Chat',
      messages: messages || [],
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }
  saveDB();
  res.json({ ok: true });
});

app.delete('/api/chats/:id', (req, res) => {
  db.chat_histories = db.chat_histories.filter(c => c.id !== req.params.id);
  saveDB();
  res.json({ ok: true });
});

// =============================================
//   SERVE ADMIN PAGE
// =============================================

app.get('/Sagvan/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Handle React routing (fallback to index.html)
app.get('*', (req, res) => {
  if (req.url.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  ✨ Nexora-AI.com Server läuft!`);
  console.log(`  🌐 Web-Interface:   http://localhost:${PORT}`);
  console.log(`  📡 Feedback-API:    http://localhost:${PORT}/api/feedback`);
  console.log(`  🔑 Auth-API:        http://localhost:${PORT}/api/auth/*`);
  console.log(`==================================================`);
});

