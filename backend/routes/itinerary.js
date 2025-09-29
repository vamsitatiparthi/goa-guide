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
    const distKm = this.haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
    // Parse hour from timeStr 'HH:MM'
    let hour = 9;
    try { hour = parseInt((timeStr || '09:00').split(':')[0], 10); } catch {}
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

    return {
      itinerary,
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
      stay_suggestions
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
      
      // Determine weather impact on activities
      const impact = this.assessWeatherImpact(weather);
      
      return { ...weather, impact };
    } catch (error) {
      console.error('Weather API error:', error);
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
      if (this.preferences.interests) {
        const categoryMatch = this.preferences.interests.some(interest => 
          this.matchCategory(poi.category, interest)
        );
        if (categoryMatch) score += 30;
      }
      
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
    const selectedPois = pois.slice(0, Math.min(duration * 3, pois.length));
    const poisPerDay = Math.ceil(selectedPois.length / duration);
    const baseDate = startDate && !isNaN(new Date(startDate)) ? new Date(startDate) : new Date();
    
    for (let day = 1; day <= duration; day++) {
      const dayStart = (day - 1) * poisPerDay;
      const dayEnd = Math.min(day * poisPerDay, selectedPois.length);
      const dayPois = selectedPois.slice(dayStart, dayEnd);
      
      // Add relevant events for this day
      const dayEvents = events.filter(event => {
        const eventDate = new Date(event.start_date);
        return eventDate.getDate() === (new Date().getDate() + day - 1);
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
    
    // Get POIs near Goa
    const poisQuery = `
      SELECT *, ST_X(location) as longitude, ST_Y(location) as latitude
      FROM pois 
      WHERE ST_DWithin(location, ST_GeomFromText('POINT(73.8370 15.4989)', 4326), 0.5)
      ORDER BY rating DESC
      LIMIT 20
    `;
    
    const poisResult = await pool.query(poisQuery);
    
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
      poisResult.rows,
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

// GET /api/v1/trips/:tripId/itinerary - alias mount point (frontend calls this)
router.get('/:tripId/itinerary', authenticateUser, [
  param('tripId').isUUID(),
  query('include_alternatives').optional().isBoolean()
], handleGetItinerary);

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
