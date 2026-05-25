const express = require('express');
const path = require('path');
const fs = require('fs');
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

// Initialize database schema
function initializeSchema() {
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
    if (err) {
      console.error('❌ Fehler beim Erstellen der Tabelle:', err.message);
    } else {
      console.log('📋 Datenbank-Schema initialisiert.');
      migrateFromJsonToSqlite();
    }
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
  console.log(`  🗄️  Datenbank:      SQLite (nexora.db)`);
  console.log(`==================================================`);
});
