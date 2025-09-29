const express = require('express');
const { param, query, body, validationResult } = require('express-validator');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Database and cache setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes cache

// Middleware
const authenticateUser = (req, res, next) => {
  req.userId = req.headers['x-user-id'] || 'demo-user-' + Date.now();
  next();
};

// Budget-first itinerary optimizer
class ItineraryOptimizer {
  constructor(budget, partySize, tripType, preferences = {}) {
    this.budget = budget;
    this.partySize = partySize;
    this.tripType = tripType;
    this.preferences = preferences;
    this.costBreakdown = {
      accommodation: 0,
      activities: 0,
      transport: 0,
      food: 0,
      miscellaneous: 0
    };
  }

  // Optional: short tip per day using LLM (OpenAI-compatible)
  async refineDayTipWithLLM(dayContext) {
    try {
      const apiKey = process.env.FREE_AI_API_KEY;
      const apiUrl = process.env.FREE_AI_API_URL;
      const model = process.env.FREE_AI_MODEL || 'gpt-3.5-turbo';
      if (!apiKey || !apiUrl) return null;

      const keyStr = JSON.stringify(dayContext);
      const cacheKey = 'day_tip_' + crypto.createHash('sha1').update(keyStr).digest('hex');
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const body = {
        model,
        messages: [
          { role: 'system', content: 'You are GoaGuide AI. Return one short local tip for the day (max 20 words). Example: “Carry cash for Anjuna flea market; sunsets best 6:15–6:40pm at Vagator.” Output plain text only.' },
          { role: 'user', content: `Day context: ${keyStr}` }
        ],
        temperature: 0.6,
        max_tokens: 60
      };
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
      const resp = await axios.post(`${apiUrl.replace(/\/$/, '')}/chat/completions`, body, { headers, timeout: 10000 });
      const text = resp.data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        const tip = text.replace(/^"|"$/g, '');
        cache.set(cacheKey, tip, 3600);
        return tip;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async refineNarrativeWithLLM(narrative, context) {
    try {
      const apiKey = process.env.FREE_AI_API_KEY;
      const apiUrl = process.env.FREE_AI_API_URL; // e.g., https://api.openrouter.ai/v1 or any OpenAI-compatible endpoint
      const model = process.env.FREE_AI_MODEL || 'gpt-3.5-turbo';
      if (!apiKey || !apiUrl) return null;

      const cacheKey = 'narr_' + crypto.createHash('sha1').update((narrative || '') + '|' + (context || '')).digest('hex');
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      // OpenAI-compatible Chat Completions request body
      const body = {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are GoaGuide AI, a friendly local travel planner for Goa. Rewrite the itinerary narrative to be clear, concise, and helpful. Keep it short and practical. Use the style: Day X: A → B → C. End with a single-line cost and 2-3 highlights, then one short tip line.'
          },
          {
            role: 'user',
            content: `Context:\n${context}\n\nOriginal narrative:\n${narrative}`
          }
        ],
        temperature: 0.6,
        max_tokens: 300
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      const resp = await axios.post(`${apiUrl.replace(/\/$/, '')}/chat/completions`, body, { headers, timeout: 10000 });
      const text = resp.data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        cache.set(cacheKey, text, 3600); // cache 1 hour
        return text;
      }
      return null;
    } catch (e) {
      console.warn('LLM refine failed, using deterministic narrative. Error:', e.message);
      return null;
    }
  }
  // Local-guide style stay suggestions based on interests and trip type
  getStaySuggestions(preferences = {}, tripType = 'solo') {
    const interests = (preferences.interests || []).map(s => (s || '').toLowerCase());
    const picks = [];
    const push = (area, why, good_for) => picks.push({ area, why, good_for });

    const likesBeaches = interests.some(i => /beach/.test(i));
    const likesNight = interests.some(i => /night/.test(i));
    const likesCulture = interests.some(i => /(historical|culture|church|fort)/.test(i));
    const likesFood = interests.some(i => /(food|cuisine)/.test(i));
    const likesNature = interests.some(i => /(nature|wildlife|adventure)/.test(i));

    if (likesBeaches || ['friends','couple'].includes(tripType)) {
      push('Baga / Calangute', 'Lively beaches, shacks, water sports and easy transfers', 'beaches · nightlife');
      push('Candolim / Sinquerim', 'Quieter stretch but close to all action', 'couples · relaxed vibe');
    }
    if (likesNight) {
      push('Anjuna / Vagator', 'Clubs, sundowners and cliff-side views', 'nightlife · sunsets');
    }
    if (likesCulture || likesFood) {
      push('Panjim / Altinho', 'Central, heritage lanes and great local eateries', 'culture · food walks');
    }
    if (likesNature) {
      push('Colva / Palolem (South Goa)', 'Laid-back beaches and greener landscapes', 'slow travel · families');
    }
    if (picks.length === 0) {
      push('Candolim', 'Balanced access to beaches, forts and restaurants', 'first-time visitors');
    }
    return picks.slice(0,4);
  }
  // Build a concise GoaGuide AI-style narrative from the computed itinerary
  buildNarrative(itinerary, totalCost) {
    try {
      const lines = [];
      const highlightsSet = new Set();

      for (const day of itinerary) {
        // Try to map morning/afternoon/evening from activities by time
        const acts = (day.activities || []).slice().sort((a,b)=>a.time.localeCompare(b.time));
        const morning = acts.find(a => a.time < '12:00');
        const afternoon = acts.find(a => a.time >= '12:00' && a.time < '18:00');
        const evening = acts.find(a => a.time >= '18:00') || acts.find(a => a.type === 'event');

        const names = [morning, afternoon, evening]
          .filter(Boolean)
          .map(a => a.activity?.name || a.activity?.title)
          .filter(Boolean);

        if (names.length > 0) {
          // Keep it concise, friendly, like a local friend
          lines.push(`Day ${day.day}: ${names.join(' → ')}.`);
        }

        // Collect highlights from categories
        for (const a of acts) {
          const cat = (a.activity?.category || '').toLowerCase();
          if (/beach/.test(cat)) highlightsSet.add('beaches');
          if (/historical|church|fort|heritage|religious/.test(cat)) highlightsSet.add('culture');
          if (/entertainment|night/.test(cat)) highlightsSet.add('nightlife');
          if (/market|shopping/.test(cat)) highlightsSet.add('shopping');
          if (/nature|adventure/.test(cat)) highlightsSet.add('nature');
          if (/food|cuisine|restaurant|shack/.test(a.activity?.description || '')) highlightsSet.add('food');
        }
      }

      const highlights = Array.from(highlightsSet).slice(0,3).join(' + ') || 'local experiences';
      const costStr = `💰 Cost: ~₹${Math.round(totalCost).toLocaleString('en-IN')}`;
      const tips = '🧭 Tips: carry cash for markets, keep sunscreen, and try local shacks';

      const summary = `${lines.join('\n')}\n${costStr} | 🌟 Highlights: ${highlights}\n${tips}`;
      return summary;
    } catch {
      return '';
    }
  }

  // --- Traffic-aware helpers (simple, no external APIs) ---
  haversineKm(lat1, lon1, lat2, lon2) {
    function toRad(v) { return (v * Math.PI) / 180; }
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Simple traffic speed profile for Goa (km/h)
  trafficSpeedKmph(hour24) {
    // Peak: 9-11, 17-20 -> 20 km/h; otherwise 30 km/h; late night 22-5 -> 35 km/h
    if (hour24 >= 22 || hour24 <= 5) return 35;
    if ((hour24 >= 9 && hour24 <= 11) || (hour24 >= 17 && hour24 <= 20)) return 20;
    return 30;
  }

  estimateTravelMinutes(from, to, baseDateStr, timeStr) {
    // from/to: objects with latitude, longitude
    if (!from || !to || from.latitude == null || to.latitude == null) return null;
    const useOSRM = (process.env.USE_OSRM || 'true') !== 'false';
    if (useOSRM) {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false`;
        return axios.get(url, { timeout: 3000 }).then(resp => {
          const r = resp.data?.routes?.[0];
          if (r) {
            const minutes = Math.max(5, Math.round((r.duration || 0) / 60));
            const distKm = Math.round(((r.distance || 0) / 1000) * 10) / 10;
            return { minutes, distKm, speed: null };
          }
          return null;
        }).catch(()=>null);
      } catch {}
    }
    const distKm = this.haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
    let hour = 9; try { hour = parseInt((timeStr || '09:00').split(':')[0], 10); } catch {}
    const speed = this.trafficSpeedKmph(hour);
    const minutes = Math.max(5, Math.round((distKm / speed) * 60));
    return { minutes, distKm: Math.round(distKm * 10) / 10, speed };
  }

  async optimizeItinerary(pois, events, duration = 2, city = 'Goa', startDate) {
    const totalBudget = this.budget * this.partySize;
    
    // Budget allocation strategy
    const budgetAllocation = this.getBudgetAllocation();
    
    // Get weather data for optimization
    const weather = await this.getWeatherData(city);
    
    // Filter and score POIs based on budget and preferences
    const scoredPois = this.scorePOIs(pois, budgetAllocation);
    
    // Filter relevant events
    const relevantEvents = this.filterEvents(events);
    
    // Generate day-wise itinerary (use startDate for correct dates)
    const itinerary = this.generateDayWiseItinerary(scoredPois, relevantEvents, duration, weather, startDate);
    
    // Calculate total cost and check budget
    const totalCost = this.calculateTotalCost(itinerary);
    const budgetStatus = totalCost <= totalBudget ? 'within_budget' : 'over_budget';
    
    // Generate alternatives if over budget
    const alternatives = budgetStatus === 'over_budget' ? 
      this.generateBudgetAlternatives(itinerary, totalBudget) : [];

    const stay_suggestions = this.getStaySuggestions(this.preferences, this.tripType);

    // Build split-stay segments for practical hubs (North/South) when duration >= 5
    const buildStaySegments = () => {
      const segments = [];
      const baseDate = startDate && !isNaN(new Date(startDate)) ? new Date(startDate) : new Date();
      const likesNight = (this.preferences?.interests || []).some(i=>/nightlife/i.test(i));
      const likesRelax = (this.preferences?.interests || []).some(i=>/nature|relax|culture|histor/i.test(i));
      if (duration >= 5) {
        const n1 = Math.min(2, duration-1);
        const n2 = duration - n1;
        const segs = [
          { region: 'North Goa', area: likesNight ? 'Calangute / Candolim' : 'Candolim', nights: n1, rationale: 'Close to beaches, shacks, nightlife and water sports.' },
          { region: 'South Goa', area: likesRelax ? 'Colva / Benaulim' : 'Colva', nights: n2, rationale: 'Quieter, scenic stretches ideal for relaxation and culture.' }
        ];
        let cursor = new Date(baseDate);
        segs.forEach(seg=>{
          const checkin = new Date(cursor);
          const checkout = new Date(checkin.getFullYear(), checkin.getMonth(), checkin.getDate()+seg.nights);
          const iso = (d)=> new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split('T')[0];
          const adults = this.partySize;
          const nightly = this.budget || 0;
          const google = `https://www.google.com/travel/hotels/${encodeURIComponent(seg.area + ', Goa')}?checkin=${iso(checkin)}&checkout=${iso(checkout)}&adults=${adults}&hl=en-IN&gl=IN&q=${encodeURIComponent('hotels under ₹'+nightly+' per night')}`;
          // Booking.com price level via pri=1..5
          let pri = 3; if (nightly<=1500) pri=1; else if (nightly<=3000) pri=2; else if (nightly<=6000) pri=3; else if (nightly<=9000) pri=4; else pri=5;
          const booking = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(seg.area+', Goa')}&checkin=${iso(checkin)}&checkout=${iso(checkout)}&group_adults=${adults}&no_rooms=1&group_children=0&selected_currency=INR&nflt=${encodeURIComponent('pri='+pri)}`;
          const mmt = `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${iso(checkin)}&checkout=${iso(checkout)}&city=Goa&locusId=CTGOI&locusType=city&roomStayQualifier=${adults}e0e&filters=${encodeURIComponent('PRICE_RANGE:between-0-'+Math.max(0,nightly))}`;
          const airbnb = `https://www.airbnb.co.in/s/Goa--India/homes?checkin=${iso(checkin)}&checkout=${iso(checkout)}&adults=${adults}${nightly?`&price_max=${nightly}`:''}`;
          segments.push({ ...seg, checkin: iso(checkin), checkout: iso(checkout), deeplinks: { google_hotels: google, booking, mmt, airbnb } });
          cursor = checkout;
        });
        return segments;
      }
      // Shorter trips: single hub based on interests
      const area = likesNight ? 'Candolim / Baga' : (likesRelax ? 'Colva' : 'Candolim');
      const checkin = new Date(baseDate);
      const checkout = new Date(checkin.getFullYear(), checkin.getMonth(), checkin.getDate()+duration);
      const iso = (d)=> new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split('T')[0];
      const adults = this.partySize; const nightly = this.budget || 0;
      const google = `https://www.google.com/travel/hotels/${encodeURIComponent(area + ', Goa')}?checkin=${iso(checkin)}&checkout=${iso(checkout)}&adults=${adults}&hl=en-IN&gl=IN&q=${encodeURIComponent('hotels under ₹'+nightly+' per night')}`;
      let pri = 3; if (nightly<=1500) pri=1; else if (nightly<=3000) pri=2; else if (nightly<=6000) pri=3; else if (nightly<=9000) pri=4; else pri=5;
      const booking = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(area+', Goa')}&checkin=${iso(checkin)}&checkout=${iso(checkout)}&group_adults=${adults}&no_rooms=1&group_children=0&selected_currency=INR&nflt=${encodeURIComponent('pri='+pri)}`;
      const mmt = `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${iso(checkin)}&checkout=${iso(checkout)}&city=Goa&locusId=CTGOI&locusType=city&roomStayQualifier=${adults}e0e&filters=${encodeURIComponent('PRICE_RANGE:between-0-'+Math.max(0,nightly))}`;
      const airbnb = `https://www.airbnb.co.in/s/Goa--India/homes?checkin=${iso(checkin)}&checkout=${iso(checkout)}&adults=${adults}${nightly?`&price_max=${nightly}`:''}`;
      return [{ region: 'Goa', area, nights: duration, rationale: 'Convenient base near most planned activities.', checkin: iso(checkin), checkout: iso(checkout), deeplinks: { google_hotels: google, booking, mmt, airbnb } }];
    };

    const stays = buildStaySegments();

    // Optionally enrich each day with a short AI tip using FREE_AI_* if available
    try {
      for (const day of itinerary) {
        const acts = (day.activities || []).map(a => ({
          time: a.time,
          name: a.activity?.name || a.activity?.title,
          category: a.activity?.category,
          notes: a.notes,
        }));
        const ctx = {
          date: day.date,
          weather: day.weather_recommendation,
          budget_per_person: this.budget,
          trip_type: this.tripType,
          interests: this.preferences?.interests || [],
          activities: acts
        };
        const tip = await this.refineDayTipWithLLM(ctx);
        if (tip) day.ai_tip = tip;
      }
    } catch {}

    // Build totals and enrich days with transport/tips/costs
    let grandGroup = 0;
    const enriched = itinerary.map(d => {
      const perPerson = Math.round(d.estimated_cost / Math.max(1,this.partySize));
      const items = [
        { label: 'Activities', per_person: Math.round((d.estimated_cost - d.transport_cost)/Math.max(1,this.partySize)), group: d.estimated_cost - d.transport_cost },
        { label: 'Transport', per_person: Math.round(d.transport_cost/Math.max(1,this.partySize)), group: d.transport_cost },
      ];
      const transport = { local: 'Scooters for short hops; taxis for airport/long hops. Expect 20–30 km/h in day traffic.', between: [] };
      // Add between segments from activity travel annotations
      try {
        for (let i=1;i<d.activities.length;i++){
          const a=d.activities[i-1], b=d.activities[i];
          if (b.travel_time_min && b.travel_dist_km) transport.between.push({ from: a.activity?.name||a.activity?.title, to: b.activity?.name||b.activity?.title, mode: b.travel_dist_km>8? 'taxi' : 'scooter', time_min: b.travel_time_min, est_cost: Math.round((b.travel_dist_km||0)*20) });
        }
      } catch {}
      const costs = { per_person: perPerson, group_total: d.estimated_cost, items };
      grandGroup += d.estimated_cost;
      return { ...d, transport, costs };
    });
    const totals = { per_person: Math.round(grandGroup/Math.max(1,this.partySize)), group: grandGroup };

    return {
      itinerary: enriched,
      budget_status: budgetStatus,
      total_cost: totalCost,
      budget_limit: totalBudget,
      cost_breakdown: this.costBreakdown,
      alternatives,
      weather_impact: weather.impact,
      weather: {
        temperature: weather.temperature,
        condition: weather.condition,
        description: weather.description,
        humidity: weather.humidity,
        wind_speed: weather.wind_speed,
      },
      optimization_score: this.calculateOptimizationScore(itinerary, totalCost, totalBudget),
      stay_suggestions,
      stays,
      totals
    };
  }

  getBudgetAllocation() {
    // Budget allocation based on trip type
    const allocations = {
      family: { accommodation: 0.4, activities: 0.3, food: 0.2, transport: 0.1 },
      solo: { accommodation: 0.3, activities: 0.4, food: 0.15, transport: 0.15 },
      couple: { accommodation: 0.35, activities: 0.35, food: 0.2, transport: 0.1 },
      friends: { accommodation: 0.3, activities: 0.4, food: 0.2, transport: 0.1 },
      adventure: { accommodation: 0.25, activities: 0.5, food: 0.15, transport: 0.1 },
      business: { accommodation: 0.5, activities: 0.2, food: 0.2, transport: 0.1 }
    };
    
    return allocations[this.tripType] || allocations.solo;
  }

  async getWeatherData(city = 'Goa') {
    try {
      const cityKey = (city || 'Goa').toLowerCase();
      const cacheKey = `weather_${cityKey}`;
      let weather = cache.get(cacheKey);

      const apiKey = process.env.OPENWEATHER_API_KEY || process.env.WEATHER_API_KEY;
      if (!weather && apiKey) {
        const response = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`
        );
        weather = {
          temperature: response.data.main.temp,
          condition: response.data.weather[0].main,
          description: response.data.weather[0].description,
          humidity: response.data.main.humidity,
          wind_speed: response.data.wind.speed
        };
        cache.set(cacheKey, weather);
      }

      // Fallback to Open-Meteo if OpenWeather not configured or failed
      if (!weather) {
        // Goa approx coordinates
        const lat = 15.4968, lon = 73.8278;
        const resp = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`);
        const current = resp.data?.current || {};
        const code = current.weather_code;
        const codeMap = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog', 51: 'Drizzle', 61: 'Rain', 71: 'Snow', 80: 'Rain showers' };
        weather = {
          temperature: current.temperature_2m ?? 28,
          condition: codeMap[code] || 'Clear',
          description: codeMap[code] || 'clear',
          humidity: 70,
          wind_speed: current.wind_speed_10m ?? 10
        };
        cache.set(cacheKey, weather);
      }

      const impact = this.assessWeatherImpact(weather);
      return { ...weather, impact };
    } catch (error) {
      console.error('Weather API error:', error.message);
      return { 
        temperature: 28, 
        condition: 'Clear', 
        description: 'sunny',
        impact: { outdoor_activities: 'favorable', beach_activities: 'favorable' }
      };
    }
  }

  assessWeatherImpact(weather) {
    if (!weather) return { outdoor_activities: 'favorable', beach_activities: 'favorable' };
    
    const impact = {};
    
    if (weather.condition === 'Rain') {
      impact.outdoor_activities = 'unfavorable';
      impact.beach_activities = 'unfavorable';
      impact.indoor_activities = 'favorable';
    } else if (weather.temperature > 35) {
      impact.outdoor_activities = 'moderate';
      impact.beach_activities = 'favorable';
    } else {
      impact.outdoor_activities = 'favorable';
      impact.beach_activities = 'favorable';
    }
    
    return impact;
  }

  scorePOIs(pois, budgetAllocation) {
    const activityBudget = this.budget * this.partySize * budgetAllocation.activities;
    
    const interestSet = new Set((this.preferences.interests || []));
    return pois.map(poi => {
      let score = 0;
      const estimatedCost = this.estimatePOICost(poi);
      
      // Budget score (higher score for lower cost)
      if (estimatedCost <= activityBudget * 0.3) score += 35;
      else if (estimatedCost <= activityBudget * 0.5) score += 22;
      else if (estimatedCost <= activityBudget * 0.7) score += 12;
      
      // Trip type preference score
      score += this.getTripTypeScore(poi, this.tripType);
      
      // Rating score (increase influence)
      score += (poi.rating || 4.0) * 8;
      
      // Category preference score (increase influence of user's interests)
      if (interestSet.size > 0) {
        const isMatch = Array.from(interestSet).some(interest => this.matchCategory(poi.category, interest));
        if (isMatch) score += 45; else score -= 8;
      }

      // Tiny deterministic jitter to avoid identical orders
      try {
        const base = poi.id || poi.name || poi.title || JSON.stringify(poi);
        const h = crypto.createHash('md5').update(String(base)).digest('hex');
        const jitter = parseInt(h.slice(0, 2), 16) % 5; // 0..4
        score += jitter;
      } catch {}
      
      return { ...poi, score, estimated_cost: estimatedCost };
    }).sort((a, b) => b.score - a.score);
  }

  estimatePOICost(poi) {
    // Base by price range (per person)
    const baseCosts = {
      free: 0,
      budget: 250,
      mid_range: 700,
      luxury: 1400
    };
    // Category multipliers to make totals more realistic (per person)
    const cat = (poi.category || '').toLowerCase();
    const multipliers = {
      beach: 0.8,            // parking, snacks, rentals
      historical: 0.5,       // tickets are usually cheap
      religious: 0.4,
      nature: 0.9,           // park entries, guides
      adventure: 1.6,        // activities like water sports
      entertainment: 1.2,    // clubs, events
      market: 0.6,           // small spends
      shopping: 0.6
    };
    const mult = multipliers[cat] || 1.0;

    const base = baseCosts[poi.price_range] != null ? baseCosts[poi.price_range] : 300;
    const perPerson = Math.round(base * mult);
    // Category-specific minimums (per person) for realistic nominal spends
    const mins = {
      beach: 150,
      historical: 50,
      religious: 0,
      nature: 100,
      adventure: 600,
      entertainment: 250,
      market: 150,
      shopping: 150,
      default: 100
    };
    const minForCat = mins[cat] != null ? mins[cat] : mins.default;
    const finalPerPerson = Math.max(perPerson, minForCat);
    return finalPerPerson * this.partySize;
  }

  getTripTypeScore(poi, tripType) {
    const preferences = {
      family: { beach: 15, historical: 10, nature: 10, religious: 5 },
      solo: { beach: 10, historical: 15, nature: 15, adventure: 20 },
      couple: { beach: 20, historical: 10, nature: 15, entertainment: 10 },
      friends: { beach: 20, entertainment: 20, adventure: 15 },
      adventure: { nature: 25, adventure: 25, beach: 10 },
      business: { historical: 10, entertainment: 15, nature: 5 }
    };
    
    return preferences[tripType]?.[poi.category] || 5;
  }

  matchCategory(poiCategory, interest) {
    const categoryMap = {
      'Beaches': ['beach'],
      'Historical sites': ['historical', 'religious'],
      'Adventure sports': ['adventure', 'nature'],
      'Nightlife': ['entertainment'],
      'Nature/Wildlife': ['nature'],
      'Shopping': ['market', 'shopping']
    };
    
    return categoryMap[interest]?.includes(poiCategory) || false;
  }

  filterEvents(events) {
    const now = new Date();
    const futureEvents = events.filter(event => new Date(event.start_date) > now);
    
    return futureEvents.map(event => {
      const title = (event.title || '').toLowerCase();
      const desc = (event.description || '').toLowerCase();
      // Infer a nominal min spend per person when price is 0/unknown
      let inferredMin = 50; // base minimum
      if (/market/.test(title) || /market/.test(desc)) inferredMin = 100;
      if (/music|fest|concert|night/.test(title) || /music|fest|concert|night/.test(desc)) inferredMin = 200;
      if (/cruise/.test(title) || /cruise/.test(desc)) inferredMin = 300;
      const base = event.price || 0;
      const perPerson = Math.max(base, inferredMin);
      return {
        ...event,
        estimated_cost: perPerson * this.partySize,
      };
    });
  }

  generateDayWiseItinerary(pois, events, duration, weather, startDate) {
    const itinerary = [];
    // Diversify and enforce interests: build buckets by category
    const interests = (this.preferences.interests || []);
    const catMap = {
      'Beaches': ['beach'],
      'Historical sites': ['historical','religious'],
      'Adventure sports': ['adventure','nature'],
      'Nightlife': ['entertainment'],
      'Nature/Wildlife': ['nature'],
      'Shopping': ['market','shopping']
    };
    const buckets = new Map();
    for (const p of pois) {
      const key = (p.category || 'other').toLowerCase();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }
    // Sort each bucket by score descending
    for (const arr of buckets.values()) arr.sort((a,b)=>b.score-a.score);

    // Category orders: interests first then others
    const allCats = Array.from(buckets.keys());
    const interestCats = [];
    for (const i of interests) {
      for (const c of (catMap[i] || [])) if (buckets.has(c) && !interestCats.includes(c)) interestCats.push(c);
    }
    const otherCats = allCats.filter(c => !interestCats.includes(c));
    const rrCats = [...interestCats, ...otherCats];

    const poisPerDay = 3; // target 3 per day
    const baseDate = startDate && !isNaN(new Date(startDate)) ? new Date(startDate) : new Date();

    let lastDominantCat = null;
    for (let day = 1; day <= duration; day++) {
      const dayPois = [];
      const catCounts = {};
      const capPerCat = 2; // max 2 from same category per day

      // 1) Ensure at least one from top-interest categories if available
      let ensured = false;
      for (const ic of interestCats) {
        const arr = buckets.get(ic) || [];
        if (arr.length > 0) {
          dayPois.push(arr.shift());
          catCounts[ic] = (catCounts[ic] || 0) + 1;
          ensured = true;
          break;
        }
      }

      // 2) Fill remaining via round-robin, rotated by day to vary order
      const rotated = rrCats.slice(((day-1) % Math.max(1, rrCats.length))).concat(rrCats.slice(0, ((day-1) % Math.max(1, rrCats.length))));
      for (const c of rotated) {
        if (dayPois.length >= poisPerDay) break;
        const arr = buckets.get(c) || [];
        if (arr.length === 0) continue;
        // Cap per-day repeats and avoid repeating last day's dominant category more than once
        const current = (catCounts[c] || 0);
        if (current >= capPerCat) continue;
        if (lastDominantCat && c === lastDominantCat && current >= 1) continue;
        dayPois.push(arr.shift());
        catCounts[c] = (catCounts[c] || 0) + 1;
        if (dayPois.length >= poisPerDay) break;
      }

      // Determine dominant category for this day for next-day avoidance
      let maxCount = -1, domCat = null;
      for (const [k,v] of Object.entries(catCounts)) { if (v > maxCount) { maxCount = v; domCat = k; } }
      lastDominantCat = domCat;
      
      // Add relevant events for this day
      const dayEvents = events.filter(event => {
        const eventDate = new Date(event.start_date);
        const dayDate = new Date(baseDate.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
        return eventDate.toDateString() === dayDate.toDateString();
      });
      
      // Build activities then compute transport cost between them
      const activities = this.optimizeDayActivities(dayPois, dayEvents, weather);
      const transportRatePerKm = 20; // INR per km (approx local taxi/scooter fuel)
      const dayTransportKm = activities.reduce((sum, a) => sum + (a.travel_dist_km || 0), 0);
      const transportCost = Math.round(dayTransportKm * transportRatePerKm);

      // Build hotel deeplinks near first activity
      const firstAct = activities.find(a => a.activity && (a.activity.lat || a.activity.location_lat)) || {};
      const lat = firstAct.activity?.lat ?? firstAct.activity?.location_lat;
      const lon = firstAct.activity?.lon ?? firstAct.activity?.location_lon;
      const nightlyBudgetPerPerson = Math.round((this.budget || 5000) / Math.max(1, duration));
      const nightlyBudgetText = `under ₹${nightlyBudgetPerPerson.toLocaleString('en-IN')}`;
      let hotel_links = [];
      if (lat != null && lon != null) {
        const hotelsUrl = `https://www.google.com/travel/hotels/Goa?q=hotels%20near%20${encodeURIComponent(lat + ',' + lon)}%20${encodeURIComponent(nightlyBudgetText)}`;
        const mapsHotels = `https://www.google.com/maps/search/${encodeURIComponent('Hotels near ' + lat + ',' + lon + ' ' + nightlyBudgetText)}`;
        hotel_links = [
          { label: 'Find Hotels Nearby', url: hotelsUrl },
          { label: 'Maps: Hotels Nearby', url: mapsHotels }
        ];
      } else {
        const hotelsUrlCity = `https://www.google.com/travel/hotels/Goa?q=${encodeURIComponent('budget ' + nightlyBudgetText)}`;
        hotel_links = [{ label: 'Find Hotels in Goa', url: hotelsUrlCity }];
      }

      const dailyBudget = Math.round((this.budget * this.partySize) / Math.max(1, duration));

      const dayItinerary = {
        day,
        date: new Date(baseDate.getTime() + (day - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        activities,
        estimated_cost: dayPois.reduce((sum, poi) => sum + poi.estimated_cost, 0) +
                       dayEvents.reduce((sum, event) => sum + event.estimated_cost, 0) +
                       transportCost,
        transport_cost: transportCost,
        weather_recommendation: this.getDayWeatherRecommendation(weather, day),
        hotel_suggestions: hotel_links
      };

      // Keep recommendations within per-day budget by trimming lowest-priority late activities
      // Priority order: keep morning, then afternoon, then evening if over budget
      const costOf = (a) => (a.activity?.estimated_cost || 0);
      if (dayItinerary.estimated_cost > dailyBudget && dayItinerary.activities.length > 1) {
        // Try removing the last (usually evening) activity first
        let pruned = [...dayItinerary.activities];
        while (pruned.length > 1 && dayItinerary.estimated_cost > dailyBudget) {
          const last = pruned.pop();
          dayItinerary.estimated_cost -= costOf(last);
        }
        dayItinerary.activities = pruned;
      }
      
      itinerary.push(dayItinerary);
    }
    
    return itinerary;
  }

  optimizeDayActivities(pois, events, weather) {
    const activities = [];
    
    // Morning activities (9 AM - 12 PM)
    const morningPois = pois.filter(poi => 
      weather.impact.outdoor_activities !== 'unfavorable' || poi.category === 'indoor'
    );
    
    if (morningPois.length > 0) {
      activities.push({
        time: '09:00',
        type: 'poi',
        activity: morningPois[0],
        duration: '3 hours',
        notes: this.getActivityNotes(morningPois[0], weather)
      });
    }
    
    // Afternoon activities (1 PM - 5 PM)
    if (pois.length > 1) {
      activities.push({
        time: '13:00',
        type: 'poi',
        activity: pois[1],
        duration: '4 hours',
        notes: this.getActivityNotes(pois[1], weather)
      });
    }
    
    // Evening events
    events.forEach(event => {
      const eventTime = new Date(event.start_date).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
      });
      
      activities.push({
        time: eventTime,
        type: 'event',
        activity: event,
        duration: '2-4 hours',
        notes: `Local event - ${event.description}`
      });
    });
    
    // Sort by time and annotate travel time between consecutive activities
    const sorted = activities.sort((a, b) => a.time.localeCompare(b.time));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const travel = this.estimateTravelMinutes(
        { latitude: prev.activity.latitude, longitude: prev.activity.longitude },
        { latitude: curr.activity.latitude, longitude: curr.activity.longitude },
        null,
        curr.time
      );
      if (travel) {
        const note = `Est. travel: ${travel.minutes} min for ~${travel.distKm} km (traffic-adjusted)`;
        curr.notes = curr.notes ? `${curr.notes}. ${note}` : note;
        curr.travel_time_min = travel.minutes;
        curr.travel_dist_km = travel.distKm;
      }
    }
    return sorted;
  }

  getActivityNotes(activity, weather) {
    const notes = [];
    
    if (activity.category === 'beach' && weather.condition === 'Rain') {
      notes.push('Consider indoor alternatives due to rain');
    } else if (activity.category === 'outdoor' && weather.temperature > 35) {
      notes.push('Carry water and sun protection - high temperature');
    } else if (activity.category === 'beach' && weather.condition === 'Clear') {
      notes.push('Perfect weather for beach activities');
    }
    
    if (activity.estimated_cost === 0) {
      notes.push('Free activity - great for budget');
    }
    
    return notes.join('. ');
  }

  getDayWeatherRecommendation(weather, day) {
    if (!weather) return 'Check local weather conditions';
    
    if (weather.condition === 'Rain') {
      return 'Rainy day - focus on indoor activities and covered areas';
    } else if (weather.temperature > 35) {
      return 'Hot day - plan early morning and evening activities';
    } else {
      return 'Good weather for outdoor activities';
    }
  }

  calculateTotalCost(itinerary) {
    return itinerary.reduce((total, day) => total + day.estimated_cost, 0);
  }

  generateBudgetAlternatives(itinerary, budgetLimit) {
    const alternatives = [];
    
    // Alternative 1: Remove most expensive activities
    const alt1 = this.createBudgetAlternative(itinerary, budgetLimit, 'remove_expensive');
    if (alt1) alternatives.push(alt1);
    
    // Alternative 2: Replace with cheaper options
    const alt2 = this.createBudgetAlternative(itinerary, budgetLimit, 'replace_cheaper');
    if (alt2) alternatives.push(alt2);
    
    // Alternative 3: Reduce duration
    const alt3 = this.createBudgetAlternative(itinerary, budgetLimit, 'reduce_duration');
    if (alt3) alternatives.push(alt3);
    
    return alternatives;
  }

  createBudgetAlternative(itinerary, budgetLimit, strategy) {
    let modifiedItinerary = JSON.parse(JSON.stringify(itinerary));
    
    switch (strategy) {
      case 'remove_expensive':
        modifiedItinerary = this.removeExpensiveActivities(modifiedItinerary, budgetLimit);
        return {
          type: 'remove_expensive',
          description: 'Remove most expensive activities to fit budget',
          itinerary: modifiedItinerary,
          savings: this.calculateTotalCost(itinerary) - this.calculateTotalCost(modifiedItinerary)
        };
        
      case 'replace_cheaper':
        modifiedItinerary = this.replaceCheaperOptions(modifiedItinerary, budgetLimit);
        return {
          type: 'replace_cheaper',
          description: 'Replace activities with budget-friendly alternatives',
          itinerary: modifiedItinerary,
          savings: this.calculateTotalCost(itinerary) - this.calculateTotalCost(modifiedItinerary)
        };
        
      case 'reduce_duration':
        modifiedItinerary = modifiedItinerary.slice(0, -1); // Remove last day
        return {
          type: 'reduce_duration',
          description: 'Reduce trip duration by one day',
          itinerary: modifiedItinerary,
          savings: this.calculateTotalCost(itinerary) - this.calculateTotalCost(modifiedItinerary)
        };
    }
  }

  removeExpensiveActivities(itinerary, budgetLimit) {
    let currentCost = this.calculateTotalCost(itinerary);
    
    for (let day of itinerary) {
      if (currentCost <= budgetLimit) break;
      
      // Sort activities by cost (descending)
      day.activities.sort((a, b) => (b.activity.estimated_cost || 0) - (a.activity.estimated_cost || 0));
      
      // Remove most expensive activity
      if (day.activities.length > 1) {
        const removed = day.activities.shift();
        day.estimated_cost -= (removed.activity.estimated_cost || 0);
        currentCost -= (removed.activity.estimated_cost || 0);
      }
    }
    
    return itinerary;
  }

  replaceCheaperOptions(itinerary, budgetLimit) {
    // This would involve querying for cheaper POI alternatives
    // For MVP, we'll just reduce costs by 30%
    for (let day of itinerary) {
      for (let activity of day.activities) {
        if (activity.activity.estimated_cost > 0) {
          activity.activity.estimated_cost *= 0.7; // 30% discount
          activity.notes += '. Switched to budget option';
        }
      }
      day.estimated_cost = day.activities.reduce((sum, act) => sum + (act.activity.estimated_cost || 0), 0);
    }
    
    return itinerary;
  }

  calculateOptimizationScore(itinerary, totalCost, budgetLimit) {
    const budgetScore = totalCost <= budgetLimit ? 30 : Math.max(0, 30 - ((totalCost - budgetLimit) / budgetLimit) * 30);
    const varietyScore = Math.min(25, itinerary.length * 5); // Points for variety
    const preferenceScore = 25; // Simplified for MVP
    const weatherScore = 20; // Simplified for MVP
    
    return Math.round(budgetScore + varietyScore + preferenceScore + weatherScore);
  }
}

// Shared handler to generate itinerary
async function handleGetItinerary(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tripId } = req.params;
    const includeAlternatives = req.query.include_alternatives === 'true';
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Get trip details
    const tripQuery = `
      SELECT * FROM trips 
      WHERE id = $1 AND user_id = $2 AND status IN ('ready', 'planning')
    `;
    
    const tripResult = await pool.query(tripQuery, [tripId, req.userId]);
    
    if (tripResult.rows.length === 0) {
      return res.status(404).json({ error: 'Trip not found or not ready for itinerary' });
    }
    
    const trip = tripResult.rows[0];
    
    // Fetch POIs: prefer OpenTripMap live data; fallback to curated DB if available
    const otmKey = process.env.OPENTRIPMAP_API_KEY;
    let otmPois = [];
    const interestKindsMap = {
      beaches: 'beaches',
      historical: 'historic,forts,castles,architecture,monuments,churches',
      religious: 'temples,churches',
      nature: 'natural,parks,view_points',
      adventure: 'water_sports,sport,amusements',
      entertainment: 'clubs,pubs,adult,nigthclubs,cinemas',
      market: 'malls,shops,marketplaces',
      shopping: 'malls,shops,marketplaces',
      food: 'catering',
    };
    const kindsForInterests = () => {
      const ints = (trip.questionnaire_responses?.interests || []).map(s=>s.toLowerCase());
      const kinds = new Set();
      for (const i of ints) {
        if (/beach/.test(i)) kinds.add('beaches');
        if (/historical|culture|fort|church/.test(i)) kinds.add('historic');
        if (/nature|wildlife/.test(i)) kinds.add('natural');
        if (/adventure/.test(i)) kinds.add('water_sports');
        if (/night/.test(i)) kinds.add('clubs');
        if (/shopping|market/.test(i)) kinds.add('shops');
        if (/food|cuisine/.test(i)) kinds.add('catering');
      }
      if (kinds.size === 0) return 'beaches,historic,catering,shops';
      return Array.from(kinds).join(',');
    };
    const otmFetch = async () => {
      if (!otmKey) return [];
      const cacheKey = 'otm_goa_' + (tripId || 'default') + '_' + (kindsForInterests());
      const got = cache.get(cacheKey);
      if (got) return got;
      // Goa bounding box approx
      const bbox = { lon_min: 73.6, lon_max: 74.3, lat_min: 14.9, lat_max: 15.9 };
      const kinds = kindsForInterests();
      const url = `https://api.opentripmap.com/0.1/en/places/bbox?lon_min=${bbox.lon_min}&lat_min=${bbox.lat_min}&lon_max=${bbox.lon_max}&lat_max=${bbox.lat_max}&kinds=${encodeURIComponent(kinds)}&rate=1&limit=80&apikey=${otmKey}`;
      const r = await axios.get(url, { timeout: 6000 });
      const features = r.data?.features || [];
      const mapped = features.map(f => {
        const p = f.properties || {};
        const g = f.geometry || {}; const coords = g.coordinates || [];
        const lon = coords[0]; const lat = coords[1];
        const name = p.name || p.osm?.name || 'Place';
        const cat = (p.kinds || '').split(',')[0] || 'other';
        // Rough rating: OTM rate 1..7; scale to 3.5..5
        const rating = 3.5 + ((p.rate || 1) / 7) * 1.5;
        const price_range = /beach|market|natural/.test(cat) ? 'budget' : /historic|museum|fort/.test(cat) ? 'budget' : 'mid_range';
        return { id: p.xid || p.osm?.id || name+lat+lon, name, title: name, latitude: lat, longitude: lon, category: cat.includes('beach')?'beach':cat.includes('historic')?'historical':cat.includes('natural')?'nature':cat.includes('clubs')?'entertainment':cat.includes('shops')?'shopping':cat.includes('catering')?'food':'other', rating, price_range };
      });
      cache.set(cacheKey, mapped, 600);
      return mapped;
    };

    try { otmPois = await otmFetch(); } catch (e) { console.warn('OpenTripMap fetch failed', e.message); }

    // Fallback to DB curated POIs (optional table)
    let dbPois = [];
    try {
      const poisQuery = `
        SELECT *, ST_X(location) as longitude, ST_Y(location) as latitude
        FROM pois 
        WHERE ST_DWithin(location, ST_GeomFromText('POINT(73.8370 15.4989)', 4326), 0.5)
        ORDER BY rating DESC
        LIMIT 20
      `;
      const poisResult = await pool.query(poisQuery);
      dbPois = poisResult.rows || [];
    } catch {}
    const poisCombined = [...otmPois, ...dbPois];
    
    // Get upcoming events
    const eventsQuery = `
      SELECT *, ST_X(location) as longitude, ST_Y(location) as latitude
      FROM events 
      WHERE start_date > NOW() 
        AND start_date < NOW() + INTERVAL '30 days'
        AND curator_approved = true
      ORDER BY start_date
      LIMIT 10
    `;
    
    const eventsResult = await pool.query(eventsQuery);
    
    // Extract trip preferences
    const responses = trip.questionnaire_responses || {};
    const duration = responses.duration || 2;
    const startDate = responses.start_date; // ISO date string from questionnaire
    const city = (responses.origin_city || trip.destination || 'Goa') + ', IN';
    const budget = trip.budget_per_person || 5000;
    
    // Initialize optimizer
    const optimizer = new ItineraryOptimizer(
      budget,
      trip.party_size || 1,
      trip.trip_type || 'solo',
      responses
    );
    
    // Generate optimized itinerary
    const result = await optimizer.optimizeItinerary(
      poisCombined,
      eventsResult.rows,
      duration,
      city,
      startDate
    );
    // Itinerary already generated within optimizeItinerary with proper costs and startDate
    
    // Log audit event (best-effort)
    try {
      await pool.query(
        'SELECT log_audit_event($1, $2, $3, $4)',
        ['itinerary_generated', 'trip', tripId, JSON.stringify({ 
          budget_status: result.budget_status,
          total_cost: result.total_cost,
          optimization_score: result.optimization_score
        })]
      );
    } catch (e) {
      console.warn('log_audit_event not available, continuing. Error:', e.message);
    }
    
    const response = {
      trip_id: tripId,
      ...result,
      generated_at: new Date().toISOString(),
      trace_id: traceId
    };
    
    if (!includeAlternatives) {
      delete response.alternatives;
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('Error generating itinerary:', error);
    res.status(500).json({ error: 'Failed to generate itinerary' });
  }
}

// GET /api/v1/itinerary/:tripId - original mount point
router.get('/:tripId', authenticateUser, [
  param('tripId').isUUID(),
  query('include_alternatives').optional().isBoolean()
], handleGetItinerary);

// GET /api/v1/trips/:tripId/itinerary - when mounted at '/api/v1/trips'
router.get('/:tripId/itinerary', authenticateUser, [
  param('tripId').isUUID().withMessage('Invalid trip ID'),
  query('include_alternatives').optional().isBoolean().toBoolean()
], handleGetItinerary);

// Re-optimize: allow tweaking budget and/or interests, then frontend refetches itinerary
router.post('/:tripId/optimize', authenticateUser, [
  param('tripId').isUUID().withMessage('Invalid trip ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { tripId } = req.params;
    const { budget_adjustment, interests } = req.body || {};

    // Load trip
    const tr = await pool.query('SELECT * FROM trips WHERE id = $1 AND user_id = $2', [tripId, req.userId]);
    if (tr.rows.length === 0) return res.status(404).json({ error: 'Trip not found' });

    const trip = tr.rows[0];
    let newBudget = trip.budget_per_person;
    if (typeof budget_adjustment === 'number' && isFinite(budget_adjustment)) {
      newBudget = Math.max(500, Math.round((trip.budget_per_person || 5000) + budget_adjustment));
      await pool.query('UPDATE trips SET budget_per_person = $1 WHERE id = $2 AND user_id = $3', [newBudget, tripId, req.userId]);
    }

    // Merge interests into questionnaire_responses
    if (Array.isArray(interests)) {
      const responses = trip.questionnaire_responses || {};
      responses.interests = interests;
      await pool.query('UPDATE trips SET questionnaire_responses = $1 WHERE id = $2 AND user_id = $3', [responses, tripId, req.userId]);
    }

    // Nothing else to do here; client will call GET /itinerary to recompute and fetch
    return res.json({ ok: true, budget_per_person: newBudget });
  } catch (e) {
    console.error('Re-optimize error:', e);
    return res.status(500).json({ error: 'Failed to apply optimization parameters' });
  }
});

// POST /api/v1/trips/:tripId/itinerary/optimize - Re-optimize with new constraints
router.post('/:tripId/optimize', authenticateUser, [
  param('tripId').isUUID(),
  body('budget_adjustment').optional().isFloat(),
  body('duration_adjustment').optional().isInt({ min: 1, max: 7 }),
  body('preference_changes').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tripId } = req.params;
    const { budget_adjustment, duration_adjustment, preference_changes } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // This would re-run the optimization with new parameters
    // For MVP, return a simple response
    res.json({
      trip_id: tripId,
      message: 'Itinerary re-optimization requested',
      adjustments: {
        budget_adjustment,
        duration_adjustment,
        preference_changes
      },
      status: 'processing',
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error re-optimizing itinerary:', error);
    res.status(500).json({ error: 'Failed to re-optimize itinerary' });
  }
});

module.exports = router;
