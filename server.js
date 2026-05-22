const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const FEEDBACK_FILE = path.join(__dirname, 'feedback.json');

// Helper to read feedback
function readFeedback() {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) {
      return [];
    }
    const data = fs.readFileSync(FEEDBACK_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading feedback file:', err);
    return [];
  }
}

// Helper to write feedback
function writeFeedback(data) {
  try {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing feedback file:', err);
  }
}

// Route to get all feedback
app.get('/api/feedback', (req, res) => {
  res.json(readFeedback());
});

// Route to post new feedback
app.post('/api/feedback', (req, res) => {
  const { username, avatar, content, role } = req.body;
  if (!username || !content) {
    return res.status(400).json({ error: 'Username and content are required' });
  }

  const feedbacks = readFeedback();
  const newFeedback = {
    id: 'fb_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    username,
    avatar: avatar || username.charAt(0).toUpperCase(),
    content,
    timestamp: 'Gerade eben',
    role: role || 'Gast'
  };

  feedbacks.push(newFeedback);
  writeFeedback(feedbacks);

  res.status(201).json(newFeedback);
});

// Default route (serves index.html for any other requests to allow direct routing if needed)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  ✨ Nexora-AI.com Server läuft!`);
  console.log(`  🌐 Web-Interface:   http://localhost:${PORT}`);
  console.log(`  📡 Feedback-API:    http://localhost:${PORT}/api/feedback`);
  console.log(`==================================================`);
});

