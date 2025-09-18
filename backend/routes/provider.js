const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const authenticateProvider = (req, res, next) => {
  req.providerId = req.headers['x-provider-id'] || 'demo-provider-' + Date.now();
  next();
};

// POST /provider/api/v1/rfps - Receive RFP
router.post('/rfps', authenticateProvider, [
  body('trip_requirements').isObject(),
  body('budget_range').isObject(),
  body('expires_at').isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { trip_requirements, budget_range, expires_at } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Create RFP record
    const rfpQuery = `
      INSERT INTO rfps (anonymized_requirements, budget_range, expires_at, trace_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const rfpResult = await pool.query(rfpQuery, [
      JSON.stringify(trip_requirements),
      JSON.stringify(budget_range),
      expires_at,
      traceId
    ]);
    
    const rfp = rfpResult.rows[0];
    
    res.status(201).json({
      rfp_id: rfp.id,
      requirements: trip_requirements,
      budget_range,
      expires_at: rfp.expires_at,
      status: 'active',
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error receiving RFP:', error);
    res.status(500).json({ error: 'Failed to receive RFP' });
  }
});

// POST /provider/api/v1/rfps/:rfpId/offers - Submit offer
router.post('/rfps/:rfpId/offers', authenticateProvider, [
  param('rfpId').isUUID(),
  body('price').isFloat({ min: 0 }),
  body('description').isString(),
  body('inclusions').optional().isArray(),
  body('validity_hours').optional().isInt({ min: 1, max: 168 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { rfpId } = req.params;
    const { price, description, inclusions = [], validity_hours = 24 } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Check if RFP exists and is active
    const rfpQuery = 'SELECT * FROM rfps WHERE id = $1 AND status = $2 AND expires_at > NOW()';
    const rfpResult = await pool.query(rfpQuery, [rfpId, 'active']);
    
    if (rfpResult.rows.length === 0) {
      return res.status(404).json({ error: 'RFP not found or expired' });
    }
    
    const expiresAt = new Date(Date.now() + validity_hours * 60 * 60 * 1000);
    
    // Create offer
    const offerQuery = `
      INSERT INTO offers (
        rfp_id, provider_id, price, description, inclusions, 
        validity_hours, expires_at, trace_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const offerResult = await pool.query(offerQuery, [
      rfpId, req.providerId, price, description, 
      JSON.stringify(inclusions), validity_hours, expiresAt, traceId
    ]);
    
    const offer = offerResult.rows[0];
    
    res.status(201).json({
      offer_id: offer.id,
      rfp_id: rfpId,
      price,
      currency: 'INR',
      description,
      inclusions,
      validity_hours,
      expires_at: expiresAt,
      status: 'active',
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error submitting offer:', error);
    res.status(500).json({ error: 'Failed to submit offer' });
  }
});

module.exports = router;
