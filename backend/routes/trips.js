const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware to extract user ID from JWT (simplified for MVP)
const authenticateUser = (req, res, next) => {
  // In production, validate JWT token here
  // For MVP, we'll use a simple user ID from header
  req.userId = req.headers['x-user-id'] || 'demo-user-' + Date.now();
  next();
};

// Validation middleware
const validateTrip = [
  body('destination').isString().isLength({ min: 1, max: 100 }),
  body('input_text').isString().isLength({ min: 1, max: 500 }),
  body('party_size').optional().isInt({ min: 1, max: 20 }),
  body('budget_per_person').optional().isFloat({ min: 0 }),
  body('trip_type').optional().isIn(['family', 'solo', 'couple', 'friends', 'business', 'adventure'])
];

const validateAnswers = [
  body('answers').isObject(),
  param('tripId').isUUID()
];

// Helper function to generate follow-up questions
const generateQuestions = (tripData, existingAnswers = {}) => {
  const questions = [];
  
  // Trip date range (start and end)
  if (!existingAnswers.start_date) {
    questions.push({
      id: 'start_date',
      text: 'When does your trip start?',
      type: 'date',
      required: true
    });
  }
  if (!existingAnswers.end_date) {
    questions.push({
      id: 'end_date',
      text: 'When does your trip end?',
      type: 'date',
      required: true
    });
  }
  
  if (!existingAnswers.origin_city) {
    questions.push({
      id: 'origin_city',
      text: 'Which city will you be traveling from?',
      type: 'text',
      required: true
    });
  }
  
  if (!existingAnswers.transport_mode) {
    questions.push({
      id: 'transport_mode',
      text: 'How would you prefer to travel?',
      type: 'single_choice',
      options: ['Flight', 'Train', 'Bus', 'Car', 'No preference'],
      required: true
    });
  }
  
  if (!existingAnswers.accommodation_type) {
    questions.push({
      id: 'accommodation_type',
      text: 'What type of accommodation do you prefer?',
      type: 'single_choice',
      options: ['Hotel', 'Resort', 'Homestay', 'Hostel', 'Airbnb', 'No preference'],
      required: false
    });
  }
  
  // Duration will be computed from start/end dates; no separate duration question
  
  if (!existingAnswers.interests && tripData.trip_type) {
    questions.push({
      id: 'interests',
      text: 'What activities interest you most?',
      type: 'multiple_choice',
      options: ['Beaches', 'Historical sites', 'Adventure sports', 'Nightlife', 'Local cuisine', 'Shopping', 'Nature/Wildlife'],
      required: false
    });
  }
  
  return questions;
};

// Helper function to create anonymized profile
const createAnonymizedProfile = (tripData) => {
  return {
    age_bracket: '26-35', // Default for MVP
    gender: 'prefer_not_to_say', // Default for privacy
    party_size: tripData.party_size || 1,
    trip_type: tripData.trip_type || 'solo',
    budget_bracket: tripData.budget_per_person > 10000 ? 'luxury' : 
                   tripData.budget_per_person > 5000 ? 'mid_range' : 'budget'
  };
};

// POST /api/v1/trips - Create new trip
router.post('/', authenticateUser, validateTrip, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { destination, input_text, party_size, budget_per_person, trip_type } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Create anonymized profile
    const anonymizedProfile = createAnonymizedProfile(req.body);
    
    // Insert trip into database
    const query = `
      INSERT INTO trips (
        user_id, destination, input_text, party_size, budget_per_person, 
        trip_type, age_bracket, gender, budget_bracket, trace_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    
    const values = [
      req.userId,
      destination,
      input_text,
      party_size,
      budget_per_person,
      trip_type,
      anonymizedProfile.age_bracket,
      anonymizedProfile.gender,
      anonymizedProfile.budget_bracket,
      traceId
    ];
    
    const result = await pool.query(query, values);
    const trip = result.rows[0];
    
    // Generate initial questions
    const nextQuestions = generateQuestions(trip);
    
    // Log audit event (best-effort; ignore if function is missing)
    try {
      await pool.query(
        'SELECT log_audit_event($1, $2, $3, $4)',
        ['trip_created', 'trip', trip.id, JSON.stringify({ destination, input_text })]
      );
    } catch (e) {
      console.warn('log_audit_event not available, continuing. Error:', e.message);
    }
    
    res.status(201).json({
      id: trip.id,
      destination: trip.destination,
      status: trip.status,
      anonymized_profile: anonymizedProfile,
      next_questions: nextQuestions,
      created_at: trip.created_at,
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error creating trip:', error);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

// GET /api/v1/trips/:tripId - Get trip details
router.get('/:tripId', authenticateUser, [param('tripId').isUUID()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tripId } = req.params;
    
    const query = `
      SELECT * FROM trips 
      WHERE id = $1 AND user_id = $2
    `;
    
    const result = await pool.query(query, [tripId, req.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    
    const trip = result.rows[0];
    const anonymizedProfile = {
      age_bracket: trip.age_bracket,
      gender: trip.gender,
      party_size: trip.party_size,
      trip_type: trip.trip_type,
      budget_bracket: trip.budget_bracket
    };
    
    // Generate next questions based on current responses
    const nextQuestions = generateQuestions(trip, trip.questionnaire_responses || {});
    
    res.json({
      id: trip.id,
      destination: trip.destination,
      status: trip.status,
      anonymized_profile: anonymizedProfile,
      questionnaire_responses: trip.questionnaire_responses,
      next_questions: nextQuestions,
      created_at: trip.created_at,
      updated_at: trip.updated_at,
      trace_id: trip.trace_id
    });
    
  } catch (error) {
    console.error('Error fetching trip:', error);
    res.status(500).json({ error: 'Failed to fetch trip' });
  }
});

// POST /api/v1/trips/:tripId/answers - Submit questionnaire answers
router.post('/:tripId/answers', authenticateUser, validateAnswers, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tripId } = req.params;
    const { answers } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Get current trip
    const tripQuery = `
      SELECT * FROM trips 
      WHERE id = $1 AND user_id = $2
    `;
    
    const tripResult = await pool.query(tripQuery, [tripId, req.userId]);
    
    if (tripResult.rows.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    
    const trip = tripResult.rows[0];
    const currentResponses = trip.questionnaire_responses || {};
    const updatedResponses = { ...currentResponses, ...answers };
    // If both dates present, compute duration (end exclusive)
    if (updatedResponses.start_date && updatedResponses.end_date) {
      const start = new Date(updatedResponses.start_date);
      const end = new Date(updatedResponses.end_date);
      if (!isNaN(start) && !isNaN(end) && end > start) {
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const days = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
        updatedResponses.duration = Math.max(1, days);
      }
    }
    
    // Update trip with new answers
    const updateQuery = `
      UPDATE trips 
      SET questionnaire_responses = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
    
    const updateResult = await pool.query(updateQuery, [
      JSON.stringify(updatedResponses),
      tripId,
      req.userId
    ]);
    
    const updatedTrip = updateResult.rows[0];
    
    // Generate next questions
    const nextQuestions = generateQuestions(updatedTrip, updatedResponses);
    
    // Check if questionnaire is complete
    const isComplete = nextQuestions.filter(q => q.required).length === 0;
    
    if (isComplete) {
      // Update trip status to ready
      await pool.query(
        'UPDATE trips SET status = $1 WHERE id = $2',
        ['ready', tripId]
      );
    }
    
    // Log audit event (best-effort)
    try {
      await pool.query(
        'SELECT log_audit_event($1, $2, $3, $4)',
        ['answers_submitted', 'trip', tripId, JSON.stringify(answers)]
      );
    } catch (e) {
      console.warn('log_audit_event not available, continuing. Error:', e.message);
    }
    
    res.json({
      trip_id: tripId,
      status: isComplete ? 'ready' : 'planning',
      next_questions: nextQuestions,
      questionnaire_complete: isComplete,
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error submitting answers:', error);
    res.status(500).json({ error: 'Failed to submit answers' });
  }
});

// POST /api/v1/trips/:tripId/consent - Grant consent for PII sharing
router.post('/:tripId/consent', authenticateUser, [
  param('tripId').isUUID(),
  body('pii_categories').isArray(),
  body('expires_in_hours').optional().isInt({ min: 1, max: 8760 }) // Max 1 year
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tripId } = req.params;
    const { pii_categories, expires_in_hours = 24 } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Generate consent token
    const consentToken = uuidv4();
    const expiresAt = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000);
    
    // Insert consent record
    const consentQuery = `
      INSERT INTO consent_records (trip_id, consent_token, pii_categories, expires_at, trace_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const consentResult = await pool.query(consentQuery, [
      tripId,
      consentToken,
      pii_categories,
      expiresAt,
      traceId
    ]);
    
    // Update trip with consent information
    await pool.query(
      `UPDATE trips 
       SET pii_shared = true, 
           consent_tokens = consent_tokens || $1
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify({ [consentToken]: { categories: pii_categories, expires_at: expiresAt } }), tripId, req.userId]
    );
    
    // Log audit event (best-effort)
    try {
      await pool.query(
        'SELECT log_audit_event($1, $2, $3, $4)',
        ['consent_granted', 'trip', tripId, JSON.stringify({ pii_categories, consent_token: consentToken })]
      );
    } catch (e) {
      console.warn('log_audit_event not available, continuing. Error:', e.message);
    }
    
    res.json({
      consent_token: consentToken,
      pii_categories,
      expires_at: expiresAt,
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error granting consent:', error);
    res.status(500).json({ error: 'Failed to grant consent' });
  }
});

// GET /api/v1/trips - List user's trips
router.get('/', authenticateUser, async (req, res) => {
  try {
    const query = `
      SELECT id, destination, status, created_at, updated_at
      FROM trips 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `;
    
    const result = await pool.query(query, [req.userId]);
    
    res.json({
      trips: result.rows,
      total: result.rows.length
    });
    
  } catch (error) {
    console.error('Error fetching trips:', error);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

module.exports = router;
