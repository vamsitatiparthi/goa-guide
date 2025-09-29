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

    // Helper: current-year date parse for inputs like "Nov 12th to 13th"
    function parseDatesHeuristically(text) {
      try {
        const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        const now = new Date();
        const year = now.getFullYear();
        const t = text.toLowerCase().replace(/\./g,'');
        // e.g. Nov 5th to 12th or Nov 12 to 13
        const m = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\b[a-z]{3,9}\b)\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|\-|–|—|until|through)\s*(\d{1,2})(?:st|nd|rd|th)?/i);
        if (m) {
          let mon = m[1].toLowerCase();
          if (mon.length === 3) {
            const map = {jan:'january',feb:'february',mar:'march',apr:'april',may:'may',jun:'june',jul:'july',aug:'august',sep:'september',sept:'september',oct:'october',nov:'november',dec:'december'};
            mon = map[mon] || mon;
          }
          const monthIdx = months.indexOf(mon);
          if (monthIdx >= 0) {
            const d1 = parseInt(m[2],10);
            const d2 = parseInt(m[3],10);
            const start = new Date(year, monthIdx, d1);
            const end = new Date(year, monthIdx, d2);
            return { start_date: start.toISOString().slice(0,10), end_date: end.toISOString().slice(0,10) };
          }
        }
        // Simple duration: "3 days" or "for 4 days"
        const mdur = t.match(/(\d{1,2})\s*(day|days|night|nights)/);
        if (mdur) {
          return { duration_days: parseInt(mdur[1],10) };
        }
      } catch {}
      return {};
    }

    function parsePeople(text) {
      const m = (text || '').toLowerCase().match(/(\d{1,2})\s*(people|persons|person|pax|travellers|travelers)/);
      return m ? { party_size: parseInt(m[1],10) } : {};
    }
    function parseBudget(text) {
      const m = (text || '').toLowerCase().replace(/[, ]/g,'').match(/(?:inr|rs|₹)?\s*(\d{3,6})\s*(?:pp|perperson|each)?/);
      return m ? { budget_per_person: parseInt(m[1],10) } : {};
    }
    function parseInterests(text) {
      const known = ['beaches','nightlife','historical sites','historical','local cuisine','food','shopping','nature','wildlife','adventure sports','markets','water sports'];
      const t = (text||'').toLowerCase();
      const found = new Set();
      for (const k of known) if (t.includes(k)) found.add(k === 'historical' ? 'historical sites' : k);
      return found.size ? { interests: Array.from(found) } : {};
    }

    // Start with any prior parsed context from client
    let parsedAcc = (context && context.parsed && typeof context.parsed === 'object') ? { ...context.parsed } : {};

    // Try heuristic parse from the last user message to prevent repeated asking
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const heuristic = {
      ...parseDatesHeuristically(lastUser),
      ...parsePeople(lastUser),
      ...parseBudget(lastUser),
      ...parseInterests(lastUser),
    };
    parsedAcc = { destination: 'Goa', ...parsedAcc, ...heuristic };

    // Determine what's missing
    const haveDates = (parsedAcc.start_date && parsedAcc.end_date) || parsedAcc.duration_days;
    const haveBudget = !!parsedAcc.budget_per_person;
    const essentialsComplete = haveDates && haveBudget;

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
    // Merge with accumulation and heuristic
    let merged = { destination: 'Goa', ...parsedAcc, ...parsed };
    // If model provided duration but not dates, keep; if dates provided, prefer dates.
    if (merged.start_date && merged.end_date) delete merged.duration_days;

    // If essentials complete, set done=true and tailor reply not to re-ask
    const done = (merged.start_date && merged.end_date) || merged.duration_days ? !!merged.budget_per_person : false;
    let reply = json.reply;
    if (done) {
      const parts = [];
      if (merged.start_date && merged.end_date) parts.push(`dates ${merged.start_date} to ${merged.end_date}`);
      else if (merged.duration_days) parts.push(`${merged.duration_days} days`);
      if (merged.party_size) parts.push(`${merged.party_size} people`);
      if (merged.budget_per_person) parts.push(`₹${merged.budget_per_person} per person`);
      if (merged.interests?.length) parts.push(`interests: ${merged.interests.join(', ')}`);
      reply = `Great! I have ${parts.join(', ')}. Shall I plan your itinerary now?`;
    } else {
      // Ask only for missing items
      const asks = [];
      if (!haveDates) asks.push('dates (start and end) or duration');
      if (!haveBudget) asks.push('budget per person');
      if (!merged.party_size) asks.push('party size');
      if (!merged.interests || merged.interests.length === 0) asks.push('interests');
      reply = `Got it. Could you share your ${asks.join(', ')}?`;
    }

    return res.json({ reply, parsed: merged, done });
  } catch (e) {
    console.error('chat/coach error:', e.message);
    return res.status(500).json({ reply: 'Sorry, I had trouble. Could you share your dates (or duration), budget per person, party size, and interests?', parsed: {}, done: false });
  }
});

module.exports = router;
