const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const authenticateUser = (req, res, next) => {
  req.userId = req.headers['x-user-id'] || 'demo-user-' + Date.now();
  next();
};

// POST /api/v1/trips/:tripId/bookings - Create booking (hold phase)
router.post('/:tripId', authenticateUser, [
  param('tripId').isUUID(),
  body('offer_id').isUUID(),
  body('payment_method').optional().isIn(['card', 'upi', 'wallet']),
  body('special_requests').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tripId } = req.params;
    const { offer_id, payment_method = 'card', special_requests } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Check for existing booking with same idempotency key
    if (idempotencyKey) {
      const existingQuery = `
        SELECT booking_id, response_data FROM booking_idempotency 
        WHERE idempotency_key = $1 AND expires_at > NOW()
      `;
      const existingResult = await pool.query(existingQuery, [idempotencyKey]);
      
      if (existingResult.rows.length > 0) {
        return res.status(409).json(existingResult.rows[0].response_data);
      }
    }
    
    // Get offer details
    const offerQuery = `
      SELECT o.*, p.business_name, p.rating 
      FROM offers o
      JOIN providers p ON o.provider_id = p.id
      WHERE o.id = $1 AND o.status = 'active' AND o.expires_at > NOW()
    `;
    const offerResult = await pool.query(offerQuery, [offer_id]);
    
    if (offerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found or expired' });
    }
    
    const offer = offerResult.rows[0];
    const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes hold
    
    // Create booking
    const bookingQuery = `
      INSERT INTO bookings (
        trip_id, offer_id, user_id, provider_id, amount, currency,
        payment_method, hold_expires_at, trace_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    
    const bookingValues = [
      tripId, offer_id, req.userId, offer.provider_id,
      offer.price, offer.currency, payment_method, holdExpiresAt, traceId
    ];
    
    const bookingResult = await pool.query(bookingQuery, bookingValues);
    const booking = bookingResult.rows[0];
    
    // Store idempotency record
    if (idempotencyKey) {
      const responseData = {
        booking_id: booking.id,
        status: booking.status,
        amount: booking.amount,
        hold_expires_at: booking.hold_expires_at
      };
      
      await pool.query(
        `INSERT INTO booking_idempotency (idempotency_key, booking_id, response_data)
         VALUES ($1, $2, $3)`,
        [idempotencyKey, booking.id, JSON.stringify(responseData)]
      );
    }
    
    // Log audit event
    await pool.query(
      'SELECT log_audit_event($1, $2, $3, $4)',
      ['booking_created', 'booking', booking.id, JSON.stringify({
        offer_id, amount: offer.price, provider: offer.business_name
      })]
    );
    
    res.status(201).json({
      booking_id: booking.id,
      trip_id: tripId,
      offer_id,
      status: 'hold',
      amount: booking.amount,
      currency: booking.currency,
      provider: {
        name: offer.business_name,
        rating: offer.rating
      },
      hold_expires_at: booking.hold_expires_at,
      payment_method,
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PUT /api/v1/bookings/:bookingId/confirm - Confirm booking
router.put('/:bookingId/confirm', authenticateUser, [
  param('bookingId').isUUID(),
  body('payment_token').isString(),
  body('consent_confirmed').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { bookingId } = req.params;
    const { payment_token, consent_confirmed } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Get booking details
    const bookingQuery = `
      SELECT * FROM bookings 
      WHERE id = $1 AND user_id = $2 AND status = 'hold'
    `;
    const bookingResult = await pool.query(bookingQuery, [bookingId, req.userId]);
    
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found or not in hold status' });
    }
    
    const booking = bookingResult.rows[0];
    
    // Check if hold has expired
    if (new Date() > new Date(booking.hold_expires_at)) {
      await pool.query(
        'UPDATE bookings SET status = $1 WHERE id = $2',
        ['cancelled', bookingId]
      );
      return res.status(400).json({ error: 'Booking hold has expired' });
    }
    
    // Confirm booking
    const confirmQuery = `
      UPDATE bookings 
      SET status = 'confirmed', payment_token = $1, confirmed_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const confirmResult = await pool.query(confirmQuery, [payment_token, bookingId]);
    const confirmedBooking = confirmResult.rows[0];
    
    // Log audit event
    await pool.query(
      'SELECT log_audit_event($1, $2, $3, $4)',
      ['booking_confirmed', 'booking', bookingId, JSON.stringify({
        amount: booking.amount, payment_token: payment_token.substring(0, 10) + '...'
      })]
    );
    
    res.json({
      booking_id: bookingId,
      status: 'confirmed',
      confirmed_at: confirmedBooking.confirmed_at,
      amount: confirmedBooking.amount,
      currency: confirmedBooking.currency,
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error confirming booking:', error);
    res.status(500).json({ error: 'Failed to confirm booking' });
  }
});

// PUT /api/v1/bookings/:bookingId/cancel - Cancel booking
router.put('/:bookingId/cancel', authenticateUser, [
  param('bookingId').isUUID(),
  body('reason').optional().isString()
], async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    const cancelQuery = `
      UPDATE bookings 
      SET status = 'cancelled', cancelled_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status IN ('hold', 'confirmed')
      RETURNING *
    `;
    const result = await pool.query(cancelQuery, [bookingId, req.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found or cannot be cancelled' });
    }
    
    const booking = result.rows[0];
    
    // Log audit event
    await pool.query(
      'SELECT log_audit_event($1, $2, $3, $4)',
      ['booking_cancelled', 'booking', bookingId, JSON.stringify({ reason })]
    );
    
    res.json({
      booking_id: bookingId,
      status: 'cancelled',
      cancelled_at: booking.cancelled_at,
      refund_eligible: booking.status === 'confirmed',
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

module.exports = router;
