const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 600 });

// Lightweight auth context
const authenticateUser = (req, res, next) => {
  req.userId = req.headers['x-user-id'] || 'demo-user-' + Date.now();
  next();
};

// POST /api/v1/chat/coach
// Body: { messages: [{role: 'user'|'assistant'|'system', content: string}], context?: {...} }
// Returns: { reply: string, parsed?: {...}, done?: boolean }
router.post('/coach', authenticateUser, async (req, res) => {
  try {
    const { messages = [], context = {} } = req.body || {};
    const apiKey = process.env.FREE_AI_API_KEY;
    const apiUrl = process.env.FREE_AI_API_URL;
    const model = process.env.FREE_AI_MODEL || 'gpt-3.5-turbo';

    if (!apiKey || !apiUrl) {
      // Fallback heuristic reply if no AI configured
      const last = (messages[messages.length - 1]?.content || '').toLowerCase();
      let reply = 'Tell me your travel dates (start and end) or how many days, your budget per person, party size, and any interests (e.g., Beaches, Nightlife, Historical sites).';
      if (/date|day|month|week/.test(last)) reply = 'Great! What is your budget per person and how many people are traveling?';
      return res.json({ reply, parsed: {}, done: false });
    }

    // System prompt ensures structured JSON output
    const system = {
      role: 'system',
      content: [
        'You are GoaGuide AI Coach. Collect trip essentials with friendly, short questions, one step at a time.',
        'Always return pure JSON (no prose) with keys: reply(string), parsed(object), done(boolean).',
        'parsed should include any fields you can extract so far:',
        '{ destination (default "Goa"), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), duration_days, party_size, budget_per_person, trip_type, interests: [..] }',
        'Rules:',
        '- Be concise and ask one question at a time if essentials missing.',
        '- If you have enough essentials to plan (dates or duration, budget_per_person), set done=true and craft reply summarizing what you understood.',
        '- Prefer ISO dates. If user gives relative dates ("next month"), convert to concrete dates if possible; otherwise keep duration.',
      ].join('\n')
    };

    // Build messages for model
    const body = {
      model,
      messages: [system, ...messages],
      temperature: 0.6,
      max_tokens: 300
    };

    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const resp = await axios.post(`${apiUrl.replace(/\/$/, '')}/chat/completions`, body, { headers, timeout: 12000 });
    const content = resp.data?.choices?.[0]?.message?.content || '';

    // Try parse JSON strictly
    let json;
    try {
      json = JSON.parse(content);
    } catch (e) {
      // Attempt to find JSON block
      const m = content.match(/\{[\s\S]*\}$/);
      json = m ? JSON.parse(m[0]) : null;
    }

    if (!json || typeof json.reply !== 'string') {
      return res.json({ reply: 'Could you share your travel dates (or duration), budget per person, party size, and interests?', parsed: {}, done: false });
    }

    // Basic guard on parsed shape
    const parsed = json.parsed && typeof json.parsed === 'object' ? json.parsed : {};
    // Default destination to Goa
    if (!parsed.destination) parsed.destination = 'Goa';

    return res.json({ reply: json.reply, parsed, done: !!json.done });
  } catch (e) {
    console.error('chat/coach error:', e.message);
    return res.status(500).json({ reply: 'Sorry, I had trouble. Could you share your dates (or duration), budget per person, party size, and interests?', parsed: {}, done: false });
  }
});

module.exports = router;
