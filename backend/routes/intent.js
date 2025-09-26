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
  let m; // scratch regex match variable used below
  const fullMonthMap = {
    january: 'jan', february: 'feb', march: 'mar', april: 'apr', may: 'may', june: 'jun',
    july: 'jul', august: 'aug', september: 'sep', october: 'oct', november: 'nov', december: 'dec'
  };
  const ordMap = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
    ninth: 9, nineth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
    fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
    twentieth: 20, twentyfirst: 21, twentyfirsth: 21, twenty-first: 21,
    twentysecond: 22, twenty-second: 22, twentythird: 23, twenty-third: 23,
    twentyfourth: 24, twenty-fourth: 24, twentyfifth: 25, twenty-fifth: 25,
    twentysixth: 26, twenty-sixth: 26, twentyseventh: 27, twenty-seventh: 27,
    twentyeighth: 28, twenty-eighth: 28, twentyninth: 29, twenty-ninth: 29,
    thirtieth: 30, thirtyfirst: 31, thirty-first: 31
  };
  const monthsShort = ['jan','feb','mar','apr','may','jun','jul','aug','sep','sept','oct','nov','dec'];
  const monthIdxFromName = (name) => {
    if (!name) return -1;
    const key = (fullMonthMap[name] || name).slice(0, 4) === 'sept' ? 'sept' : (fullMonthMap[name] || name);
    let idx = monthsShort.indexOf(key);
    if (key === 'sept') idx = 8; // normalize 'sept'
    if (idx > 10) idx -= 1; // safeguard if array variant
    return idx;
  };
  const clampDay = (y, m, d) => {
    const last = new Date(y, m + 1, 0).getDate();
    return Math.min(Math.max(1, d), last);
  };
  // Budget: ₹7000, 7k, 7000
  const budgetMatch = t.match(/(?:₹|rs\.?\s*)?([0-9]+\.?[0-9]*)(k)?\b/);
  if (budgetMatch) {
    let val = parseFloat(budgetMatch[1]);
    if (budgetMatch[2] === 'k') val *= 1000;
    if (!isNaN(val) && val > 0) out.budget_per_person = Math.round(val);
  }

  // Pattern C: Full month name with range like 'october 20th to 30' or 'october 25 to 31'
  if (!out.start_date) {
    m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:[-–]|to)\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/);
    if (m) {
      const monName = m[1];
      const startD = parseInt(m[2], 10);
      const endD = parseInt(m[3], 10);
      const now = new Date();
      const baseYear = m[4] ? parseInt(m[4], 10) : (monthIdxFromName(monName) < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear());
      const mi = monthIdxFromName(monName);
      if (mi >= 0) {
        const sDay = clampDay(baseYear, mi, startD);
        const eDay = clampDay(baseYear, mi, endD);
        const start = new Date(baseYear, mi, sDay);
        const end = new Date(baseYear, mi, eDay);
        if (end > start) {
          out.start_date = start.toISOString().split('T')[0];
          out.end_date = end.toISOString().split('T')[0];
          out.duration_days = Math.ceil((end - start) / (24*60*60*1000));
        }
      }
    }
  }

  // Pattern D: Month name with ordinal words: 'october second to ninth'
  if (!out.start_date) {
    m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s*([a-z\-]+)\s*(?:[-–]|to)\s*([a-z\-]+)(?:\s*,?\s*(\d{4}))?/);
    if (m) {
      const monName = m[1];
      const w1 = m[2].replace(/\s+/g, '');
      const w2 = m[3].replace(/\s+/g, '');
      const d1 = ordMap[w1];
      const d2 = ordMap[w2];
      if (d1 && d2) {
        const now = new Date();
        const mi = monthIdxFromName(monName);
        const baseYear = m[4] ? parseInt(m[4], 10) : (mi < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear());
        const sDay = clampDay(baseYear, mi, d1);
        const eDay = clampDay(baseYear, mi, d2);
        const start = new Date(baseYear, mi, sDay);
        const end = new Date(baseYear, mi, eDay);
        if (end > start) {
          out.start_date = start.toISOString().split('T')[0];
          out.end_date = end.toISOString().split('T')[0];
          out.duration_days = Math.ceil((end - start) / (24*60*60*1000));
        }
      }
    }
  }

  // Pattern E: 'october first week' / 'october second week' / 'october last week'
  if (!out.start_date) {
    m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s*(first|second|third|fourth|last)\s*week(?:\s*,?\s*(\d{4}))?/);
    if (m) {
      const monName = m[1];
      const which = m[2];
      const now = new Date();
      const mi = monthIdxFromName(monName);
      const baseYear = m[3] ? parseInt(m[3], 10) : (mi < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear());
      // Find week boundaries (Mon-Sun) within that month
      const firstOfMonth = new Date(baseYear, mi, 1);
      // Find first Monday
      let d = new Date(firstOfMonth);
      while (d.getDay() !== 1) { // 1 = Monday
        d.setDate(d.getDate() + 1);
      }
      let start = new Date(d);
      if (which === 'second') start.setDate(start.getDate() + 7);
      if (which === 'third') start.setDate(start.getDate() + 14);
      if (which === 'fourth') start.setDate(start.getDate() + 21);
      if (which === 'last') {
        // Move to last Monday inside the month
        const lastOfMonth = new Date(baseYear, mi + 1, 0);
        let lastMon = new Date(lastOfMonth);
        while (lastMon.getDay() !== 1) {
          lastMon.setDate(lastMon.getDate() - 1);
        }
        start = lastMon;
      }
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      // Clamp to month
      const monthStart = new Date(baseYear, mi, 1);
      const monthEnd = new Date(baseYear, mi + 1, 0);
      const s = new Date(Math.max(start, monthStart));
      const e = new Date(Math.min(end, monthEnd));
      if (e > s) {
        out.start_date = s.toISOString().split('T')[0];
        out.end_date = e.toISOString().split('T')[0];
        out.duration_days = Math.ceil((e - s) / (24*60*60*1000));
      }
    }
  }
  // Duration in days: "3 days"
  const daysMatch = t.match(/(\d{1,2})\s*days?/);
  if (daysMatch) out.duration_days = parseInt(daysMatch[1], 10);
  // Dates: support 'dd-dd Mon', 'Mon dd–dd', 'Mon dd to dd', with optional year
  const months = monthsShort;
  // Pattern A: dd[-–to]dd Mon [YYYY]
  m = t.match(/(\d{1,2})\s*[\-–to]{1,3}\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*(\d{4})?/);
  if (m) {
    const startD = parseInt(m[1], 10);
    const endD = parseInt(m[2], 10);
    const monStr = (m[3] || '').toLowerCase();
    const year = m[4] ? parseInt(m[4], 10) : new Date().getFullYear();
    let monthIdx = months.indexOf(monStr);
    if (monStr === 'sept') monthIdx = 8;
    if (monthIdx >= 0) {
      const month = monthIdx > 10 ? monthIdx-1 : monthIdx;
      const start = new Date(year, month, startD);
      const end = new Date(year, month, endD);
      if (end > start) {
        out.start_date = start.toISOString().split('T')[0];
        out.end_date = end.toISOString().split('T')[0];
        out.duration_days = Math.ceil((end - start) / (24*60*60*1000));
      }
    }
  }
  // Pattern B: Mon dd[-–to]dd [YYYY]
  if (!out.start_date) {
    m = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*(\d{1,2})\s*[\-–to]{1,3}\s*(\d{1,2})(?:\s*,?\s*(\d{4}))?/);
    if (m) {
      const monStr = (m[1] || '').toLowerCase();
      const startD = parseInt(m[2], 10);
      const endD = parseInt(m[3], 10);
      const year = m[4] ? parseInt(m[4], 10) : new Date().getFullYear();
      let monthIdx = months.indexOf(monStr);
      if (monStr === 'sept') monthIdx = 8;
      if (monthIdx >= 0) {
        const month = monthIdx > 10 ? monthIdx-1 : monthIdx;
        const start = new Date(year, month, startD);
        const end = new Date(year, month, endD);
        if (end > start) {
          out.start_date = start.toISOString().split('T')[0];
          out.end_date = end.toISOString().split('T')[0];
          out.duration_days = Math.ceil((end - start) / (24*60*60*1000));
        }
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

  // Relative time phrases fallback if dates not parsed
  if (!out.start_date || !out.end_date) {
    const now = new Date();

    // Helper: format date to YYYY-MM-DD
    const fmt = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split('T')[0];

    // next weekend: upcoming Sat-Sun (or Fri-Sun if we want 3 days)
    if (/next\s+weekend/.test(t)) {
      const day = now.getDay(); // 0 Sun .. 6 Sat
      // find next Saturday
      const daysUntilSat = (6 - day + 7) % 7 || 7; // if today Sat, pick next Sat
      const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSat);
      const sun = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1);
      out.start_date = fmt(sat);
      out.end_date = fmt(sun);
      out.duration_days = Math.ceil((sun - sat) / (24*60*60*1000));
    }

    // next week: next Monday to Wednesday (3 days)
    if (!out.start_date && /next\s+week/.test(t)) {
      const day = now.getDay();
      // next Monday
      const daysUntilMon = ((1 - day + 7) % 7) || 7;
      const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMon);
      const wed = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 2);
      out.start_date = fmt(mon);
      out.end_date = fmt(wed);
      out.duration_days = Math.ceil((wed - mon) / (24*60*60*1000));
    }

    // next month: first Fri–Sun of next month
    if (!out.start_date && /next\s+month/.test(t)) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      // find first Friday
      let d = new Date(nextMonth);
      while (d.getDay() !== 5) { // 5 = Friday
        d.setDate(d.getDate() + 1);
      }
      const fri = new Date(d);
      const sun = new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2);
      out.start_date = fmt(fri);
      out.end_date = fmt(sun);
      out.duration_days = Math.ceil((sun - fri) / (24*60*60*1000));
    }
  }
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
