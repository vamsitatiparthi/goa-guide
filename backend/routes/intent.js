const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 });

function parseHeuristics(text) {
  const out = {
    destination: 'Goa',
    party_size: 2,
    trip_type: 'family',
    budget_per_person: undefined,
    duration_days: undefined,
    start_date: undefined,
    end_date: undefined,
    interests: []
  };
  const t = text.toLowerCase();
  // Budget: ₹7000, 7k, 7000
  const budgetMatch = t.match(/(?:₹|rs\.?\s*)?([0-9]+\.?[0-9]*)(k)?\b/);
  if (budgetMatch) {
    let val = parseFloat(budgetMatch[1]);
    if (budgetMatch[2] === 'k') val *= 1000;
    if (!isNaN(val) && val > 0) out.budget_per_person = Math.round(val);
  }
  // Duration in days: "3 days"
  const daysMatch = t.match(/(\d{1,2})\s*days?/);
  if (daysMatch) out.duration_days = parseInt(daysMatch[1], 10);
  // Dates: simple dd or dd-dd Mon or with month names
  const rangeMatch = t.match(/(\d{1,2})\s*[\-–to]{1,3}\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)?\s*(\d{4})?/);
  if (rangeMatch) {
    const startD = parseInt(rangeMatch[1], 10);
    const endD = parseInt(rangeMatch[2], 10);
    const monStr = (rangeMatch[3] || '').toLowerCase();
    const year = rangeMatch[4] ? parseInt(rangeMatch[4], 10) : new Date().getFullYear();
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','sept','oct','nov','dec'];
    let monthIdx = months.indexOf(monStr);
    if (monStr === 'sept') monthIdx = 8; // handle sept
    if (monthIdx >= 0) {
      const month = monthIdx > 10 ? monthIdx-1 : monthIdx; // adjust if 'sept' duplication
      const start = new Date(year, month, startD);
      const end = new Date(year, month, endD);
      if (end > start) {
        out.start_date = start.toISOString().split('T')[0];
        out.end_date = end.toISOString().split('T')[0];
        out.duration_days = Math.ceil((end - start) / (24*60*60*1000));
      }
    }
  }
  // Party size
  const peopleMatch = t.match(/(\d{1,2})\s*(people|persons|pax|members)/);
  if (peopleMatch) out.party_size = parseInt(peopleMatch[1], 10);
  // Trip type keywords
  if (/family/.test(t)) out.trip_type = 'family';
  else if (/couple|honeymoon/.test(t)) out.trip_type = 'couple';
  else if (/friends|gang|group/.test(t)) out.trip_type = 'friends';
  else if (/solo/.test(t)) out.trip_type = 'solo';
  // Interests
  const interestMap = [
    { key: 'Beaches', rx: /beach|sunset/ },
    { key: 'Historical sites', rx: /church|fort|basilica|heritage|history|historical/ },
    { key: 'Adventure sports', rx: /adventure|trek|water\s*sport/ },
    { key: 'Nightlife', rx: /nightlife|club|party/ },
    { key: 'Local cuisine', rx: /food|cuisine|restaurant|shack/ },
    { key: 'Shopping', rx: /market|shopping/ },
    { key: 'Nature/Wildlife', rx: /nature|wildlife|spice/ },
  ];
  interestMap.forEach(i => { if (i.rx.test(t)) out.interests.push(i.key); });
  // Destination (default Goa)
  const destMatch = t.match(/goa|panaji|panjim|anjuna|baga|calangute|palolem|candolim/);
  if (destMatch) out.destination = 'Goa';
  return out;
}

async function refineWithLLMIfAvailable(rawText, parsed) {
  try {
    const apiKey = process.env.FREE_AI_API_KEY;
    const apiUrl = process.env.FREE_AI_API_URL;
    const model = process.env.FREE_AI_MODEL || 'gpt-3.5-turbo';
    if (!apiKey || !apiUrl) return null;

    const body = {
      model,
      messages: [
        { role: 'system', content: 'Extract structured trip fields from user text. Return strict JSON with keys: destination, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), duration_days, budget_per_person, party_size, trip_type (family|solo|couple|friends|business|adventure), interests (array of strings from: Beaches, Historical sites, Adventure sports, Nightlife, Local cuisine, Shopping, Nature/Wildlife). Unknown fields can be null.' },
        { role: 'user', content: rawText }
      ],
      temperature: 0.2,
      max_tokens: 300
    };
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    const resp = await axios.post(`${apiUrl.replace(/\/$/, '')}/chat/completions`, body, { headers, timeout: 10000 });
    const text = resp.data?.choices?.[0]?.message?.content;
    try {
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const obj = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
        return obj;
      }
    } catch {}
    return null;
  } catch {
    return null;
  }
}

router.post('/parse', [body('text').isString().isLength({ min: 3, max: 1000 })], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { text } = req.body;
    const heur = parseHeuristics(text);
    const llm = await refineWithLLMIfAvailable(text, heur);
    const result = { ...heur, ...(llm || {}) };

    // Normalize derived fields
    if (!result.start_date && result.duration_days) {
      const start = new Date();
      const end = new Date(start.getTime() + result.duration_days * 24*60*60*1000);
      result.start_date = start.toISOString().split('T')[0];
      result.end_date = end.toISOString().split('T')[0];
    }

    res.json({ parsed: result });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse prompt', details: e.message });
  }
});

module.exports = router;
