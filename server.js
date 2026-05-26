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
let db = { feedback: [], users: [], sessions: [] };

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

// =============================================
//   AUTH API ROUTES
// =============================================

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  if (username.trim().length < 2) return res.status(400).json({ error: 'Benutzername muss mindestens 2 Zeichen haben.' });
  if (password.length < 4) return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen haben.' });

  const existingUser = db.users.find(u => u.username === username.trim());
  if (existingUser) return res.status(409).json({ error: 'Benutzername bereits vergeben.' });

  try {
    const passwordHash = await hashPassword(password);
    const user = {
      id: Date.now().toString() + Math.floor(Math.random()*1000),
      username: username.trim(),
      password_hash: passwordHash,
      created_at: Date.now()
    };
    db.users.push(user);
    
    const token = generateToken();
    db.sessions.push({ token, user_id: user.id, created_at: Date.now() });
    saveDB();

    console.log(`✅ Neuer User registriert: ${user.username}`);
    res.status(201).json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Serverfehler bei der Registrierung.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });

  const user = db.users.find(u => u.username === username.trim());
  if (!user) return res.status(401).json({ error: 'Benutzername nicht gefunden.' });

  try {
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Falsches Passwort.' });

    const token = generateToken();
    db.sessions.push({ token, user_id: user.id, created_at: Date.now() });
    saveDB();

    console.log(`🔓 User eingeloggt: ${user.username}`);
    res.json({ token, username: user.username });
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

  res.json({ username: user.username });
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

