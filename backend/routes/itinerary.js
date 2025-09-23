const express = require('express');
const { param, query, body, validationResult } = require('express-validator');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const axios = require('axios');
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

  async optimizeItinerary(pois, events, duration = 2) {
    const totalBudget = this.budget * this.partySize;
    
    // Budget allocation strategy
    const budgetAllocation = this.getBudgetAllocation();
    
    // Get weather data for optimization
    const weather = await this.getWeatherData();
    
    // Filter and score POIs based on budget and preferences
    const scoredPois = this.scorePOIs(pois, budgetAllocation);
    
    // Filter relevant events
    const relevantEvents = this.filterEvents(events);
    
    // Generate day-wise itinerary
    const itinerary = this.generateDayWiseItinerary(scoredPois, relevantEvents, duration, weather);
    
    // Calculate total cost and check budget
    const totalCost = this.calculateTotalCost(itinerary);
    const budgetStatus = totalCost <= totalBudget ? 'within_budget' : 'over_budget';
    
    // Generate alternatives if over budget
    const alternatives = budgetStatus === 'over_budget' ? 
      this.generateBudgetAlternatives(itinerary, totalBudget) : [];

    return {
      itinerary,
      budget_status: budgetStatus,
      total_cost: totalCost,
      budget_limit: totalBudget,
      cost_breakdown: this.costBreakdown,
      alternatives,
      weather_impact: weather.impact,
      optimization_score: this.calculateOptimizationScore(itinerary, totalCost, totalBudget)
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

  async getWeatherData() {
    try {
      const cacheKey = 'weather_goa';
      let weather = cache.get(cacheKey);
      
      if (!weather && process.env.OPENWEATHER_API_KEY) {
        const response = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?q=Goa,IN&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`
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
      if (estimatedCost <= activityBudget * 0.3) score += 30;
      else if (estimatedCost <= activityBudget * 0.5) score += 20;
      else if (estimatedCost <= activityBudget * 0.7) score += 10;
      
      // Trip type preference score
      score += this.getTripTypeScore(poi, this.tripType);
      
      // Rating score
      score += (poi.rating || 4.0) * 5;
      
      // Category preference score
      if (this.preferences.interests) {
        const categoryMatch = this.preferences.interests.some(interest => 
          this.matchCategory(poi.category, interest)
        );
        if (categoryMatch) score += 15;
      }
      
      return { ...poi, score, estimated_cost: estimatedCost };
    }).sort((a, b) => b.score - a.score);
  }

  estimatePOICost(poi) {
    const baseCosts = {
      free: 0,
      budget: 200,
      mid_range: 500,
      luxury: 1000
    };
    
    const baseCost = baseCosts[poi.price_range] || baseCosts.budget;
    return baseCost * this.partySize;
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
    
    return futureEvents.map(event => ({
      ...event,
      estimated_cost: (event.price || 0) * this.partySize
    }));
  }

  generateDayWiseItinerary(pois, events, duration, weather) {
    const itinerary = [];
    const selectedPois = pois.slice(0, Math.min(duration * 3, pois.length));
    const poisPerDay = Math.ceil(selectedPois.length / duration);
    
    for (let day = 1; day <= duration; day++) {
      const dayStart = (day - 1) * poisPerDay;
      const dayEnd = Math.min(day * poisPerDay, selectedPois.length);
      const dayPois = selectedPois.slice(dayStart, dayEnd);
      
      // Add relevant events for this day
      const dayEvents = events.filter(event => {
        const eventDate = new Date(event.start_date);
        return eventDate.getDate() === (new Date().getDate() + day - 1);
      });
      
      const dayItinerary = {
        day,
        date: new Date(Date.now() + (day - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        activities: this.optimizeDayActivities(dayPois, dayEvents, weather),
        estimated_cost: dayPois.reduce((sum, poi) => sum + poi.estimated_cost, 0) +
                       dayEvents.reduce((sum, event) => sum + event.estimated_cost, 0),
        weather_recommendation: this.getDayWeatherRecommendation(weather, day)
      };
      
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
    
    return activities.sort((a, b) => a.time.localeCompare(b.time));
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
      duration
    );
    
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
