const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// SQLite Database Setup
const dbPath = path.join(__dirname, 'nexora.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Fehler beim Öffnen der SQLite-Datenbank:', err.message);
  } else {
    console.log('✅ SQLite-Datenbank erfolgreich verbunden:', dbPath);
    initializeSchema();
  }
});

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
//   DATABASE SCHEMA
// =============================================

function initializeSchema() {
  db.serialize(() => {
    // Feedback table (existing)
    db.run(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        avatar TEXT,
        content TEXT NOT NULL,
        role TEXT DEFAULT 'Gast',
        timestamp TEXT,
        created_at INTEGER
      )
    `, (err) => {
      if (err) console.error('❌ Fehler beim Erstellen der feedback-Tabelle:', err.message);
    });

    // Users table (NEW)
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `, (err) => {
      if (err) console.error('❌ Fehler beim Erstellen der users-Tabelle:', err.message);
      else console.log('👤 Users-Tabelle bereit.');
    });

    // Sessions table (NEW)
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('❌ Fehler beim Erstellen der sessions-Tabelle:', err.message);
      else console.log('🔑 Sessions-Tabelle bereit.');
    });

    console.log('📋 Datenbank-Schema initialisiert.');
    migrateFromJsonToSqlite();
  });
}

// Migrate legacy JSON file to SQLite database
function migrateFromJsonToSqlite() {
  const FEEDBACK_FILE = path.join(__dirname, 'feedback.json');
  if (fs.existsSync(FEEDBACK_FILE)) {
    try {
      const data = fs.readFileSync(FEEDBACK_FILE, 'utf8');
      const feedbacks = JSON.parse(data || '[]');
      
      if (feedbacks.length > 0) {
        console.log(`🚚 Migriere ${feedbacks.length} Einträge von feedback.json zu SQLite...`);
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO feedback (id, username, avatar, content, role, timestamp, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        feedbacks.forEach((fb, idx) => {
          stmt.run(
            fb.id || 'fb_' + Date.now().toString(36) + idx.toString(36),
            fb.username,
            fb.avatar || fb.username.charAt(0).toUpperCase(),
            fb.content,
            fb.role || 'Gast',
            fb.timestamp || 'Gerade eben',
            Date.now() + idx // add spacing to preserve order
          );
        });
        stmt.finalize();
        
        // Rename json file to prevent re-migration
        fs.renameSync(FEEDBACK_FILE, FEEDBACK_FILE + '.bak');
        console.log('🎉 Migration abgeschlossen. feedback.json in feedback.json.bak umbenannt.');
      }
    } catch (err) {
      console.error('❌ Fehler bei der Datenbank-Migration:', err);
    }
  }
}

// =============================================
//   AUTH API ROUTES
// =============================================

// Register a new user
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }
  if (username.trim().length < 2) {
    return res.status(400).json({ error: 'Benutzername muss mindestens 2 Zeichen haben.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen haben.' });
  }

  try {
    // Check if username already exists
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE username = ?', [username.trim()], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (existing) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben.' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    const userId = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
        [username.trim(), passwordHash, now],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    // Create session token
    const token = generateToken();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)',
        [token, userId, now],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });

    console.log(`✅ Neuer User registriert: ${username.trim()} (ID: ${userId})`);
    res.status(201).json({ token, username: username.trim() });

  } catch (err) {
    console.error('❌ Registrierungsfehler:', err);
    res.status(500).json({ error: 'Serverfehler bei der Registrierung.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }

  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ?', [username.trim()], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      return res.status(401).json({ error: 'Benutzername nicht gefunden.' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Falsches Passwort.' });
    }

    // Create session token
    const token = generateToken();
    const now = Date.now();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)',
        [token, user.id, now],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });

    console.log(`🔓 User eingeloggt: ${user.username}`);
    res.json({ token, username: user.username });

  } catch (err) {
    console.error('❌ Login-Fehler:', err);
    res.status(500).json({ error: 'Serverfehler beim Login.' });
  }
});

// Check session (GET /api/auth/me)
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Kein Token angegeben.' });
  }

  const token = authHeader.slice(7);

  try {
    const session = await new Promise((resolve, reject) => {
      db.get(
        `SELECT s.*, u.username FROM sessions s 
         JOIN users u ON s.user_id = u.id 
         WHERE s.token = ?`,
        [token],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!session) {
      return res.status(401).json({ error: 'Ungültiges Token.' });
    }

    res.json({ username: session.username });

  } catch (err) {
    console.error('❌ Session-Prüfung fehlgeschlagen:', err);
    res.status(500).json({ error: 'Serverfehler.' });
  }
});

// Logout (DELETE session)
app.post('/api/auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(400).json({ error: 'Kein Token angegeben.' });
  }

  const token = authHeader.slice(7);

  try {
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM sessions WHERE token = ?', [token], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('🔒 Session gelöscht.');
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Logout-Fehler:', err);
    res.status(500).json({ error: 'Serverfehler beim Logout.' });
  }
});

// =============================================
//   FEEDBACK API ROUTES (existing)
// =============================================

// Route to get all feedback from SQLite
app.get('/api/feedback', (req, res) => {
  db.all('SELECT * FROM feedback ORDER BY created_at ASC', [], (err, rows) => {
    if (err) {
      console.error('❌ Datenbank-Fehler beim Auslesen:', err.message);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }
    res.json(rows);
  });
});

// Route to post new feedback into SQLite
app.post('/api/feedback', (req, res) => {
  const { username, avatar, content, role } = req.body;
  if (!username || !content) {
    return res.status(400).json({ error: 'Username und Inhalt sind erforderlich' });
  }

  const id = 'fb_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const newFeedback = {
    id,
    username,
    avatar: avatar || username.charAt(0).toUpperCase(),
    content,
    timestamp: 'Gerade eben',
    role: role || 'Gast',
    created_at: Date.now()
  };

  db.run(`
    INSERT INTO feedback (id, username, avatar, content, role, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    newFeedback.id,
    newFeedback.username,
    newFeedback.avatar,
    newFeedback.content,
    newFeedback.role,
    newFeedback.timestamp,
    newFeedback.created_at
  ], (err) => {
    if (err) {
      console.error('❌ Datenbank-Fehler beim Einfügen:', err.message);
      return res.status(500).json({ error: 'Datenbankfehler beim Speichern' });
    }
    res.status(201).json(newFeedback);
  });
});

// Default route (serves index.html for frontend routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  ✨ Nexora-AI.com Server läuft!`);
  console.log(`  🌐 Web-Interface:   http://localhost:${PORT}`);
  console.log(`  📡 Feedback-API:    http://localhost:${PORT}/api/feedback`);
  console.log(`  🔑 Auth-API:        http://localhost:${PORT}/api/auth/*`);
  console.log(`  🗄️  Datenbank:      SQLite (nexora.db)`);
  console.log(`==================================================`);
});

