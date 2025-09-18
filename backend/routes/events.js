const express = require('express');
const { query, validationResult } = require('express-validator');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// GET /api/v1/events - Search events by location and date
router.get('/', [
  query('lat').isFloat({ min: -90, max: 90 }),
  query('lon').isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 0.1, max: 100 }).default(10),
  query('date').optional().isISO8601(),
  query('category').optional().isIn(['festival', 'market', 'nightlife', 'cultural', 'sports', 'food'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { lat, lon, radius = 10, date, category } = req.query;
    
    let query = `
      SELECT 
        id, title, description, category, address,
        ST_X(location) as longitude, 
        ST_Y(location) as latitude,
        start_date, end_date, price, currency,
        capacity, current_bookings,
        confidence_score
      FROM events 
      WHERE curator_approved = true
        AND ST_DWithin(
          location, 
          ST_GeomFromText('POINT(${lon} ${lat})', 4326), 
          ${radius / 111.0}
        )
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (date) {
      query += ` AND DATE(start_date) = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    } else {
      query += ` AND start_date > NOW()`;
    }
    
    if (category) {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }
    
    query += ` ORDER BY start_date ASC LIMIT 50`;
    
    const result = await pool.query(query, params);
    
    const events = result.rows.map(event => ({
      ...event,
      distance_km: null, // Would calculate actual distance
      availability: event.capacity ? 
        Math.max(0, event.capacity - (event.current_bookings || 0)) : 
        'unlimited'
    }));
    
    res.json({
      events,
      total: events.length,
      search_params: { lat, lon, radius, date, category }
    });
    
  } catch (error) {
    console.error('Error searching events:', error);
    res.status(500).json({ error: 'Failed to search events' });
  }
});

module.exports = router;
