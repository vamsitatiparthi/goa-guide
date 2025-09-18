const express = require('express');
const multer = require('multer');
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

// Configure multer for photo uploads
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Mock EXIF extraction function
const extractEXIF = (buffer) => {
  // In production, use exif-parser or similar library
  return {
    gps: {
      latitude: 15.2993 + (Math.random() - 0.5) * 0.1,
      longitude: 74.1240 + (Math.random() - 0.5) * 0.1
    },
    timestamp: new Date().toISOString(),
    camera: 'Mock Camera',
    confidence: Math.random() * 0.3 + 0.7 // 0.7-1.0
  };
};

// Mock vision analysis function
const analyzeImage = async (imageBuffer) => {
  // In production, integrate with Google Vision API or similar
  const scenarios = [
    { type: 'beach', confidence: 0.85, description: 'Beach scene detected' },
    { type: 'historical', confidence: 0.92, description: 'Historical monument detected' },
    { type: 'nature', confidence: 0.78, description: 'Natural landscape detected' },
    { type: 'food', confidence: 0.88, description: 'Food/restaurant scene detected' }
  ];
  
  return scenarios[Math.floor(Math.random() * scenarios.length)];
};

// POST /api/v1/trips/:tripId/photos - Upload photo for verification
router.post('/:tripId', authenticateUser, upload.single('photo'), [
  param('tripId').isUUID(),
  body('device_attestation').optional().isString(),
  body('location_context').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Photo file is required' });
    }

    const { tripId } = req.params;
    const { device_attestation, location_context } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // Verify trip exists and belongs to user
    const tripQuery = 'SELECT id FROM trips WHERE id = $1 AND user_id = $2';
    const tripResult = await pool.query(tripQuery, [tripId, req.userId]);
    
    if (tripResult.rows.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    
    // Extract EXIF data
    const exifData = extractEXIF(req.file.buffer);
    
    // Analyze image content
    const visionAnalysis = await analyzeImage(req.file.buffer);
    
    // Generate photo hash for deduplication
    const crypto = require('crypto');
    const photoHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    
    // Mock upload to cloud storage (Cloudinary)
    const photoUrl = `https://res.cloudinary.com/goaguide/image/upload/v1/${photoHash}.jpg`;
    
    // Determine verification status based on confidence scores
    let verificationStatus = 'pending';
    let manualReviewRequired = false;
    
    const combinedConfidence = (exifData.confidence + visionAnalysis.confidence) / 2;
    
    if (combinedConfidence >= 0.85) {
      verificationStatus = 'approved';
    } else if (combinedConfidence >= 0.6) {
      verificationStatus = 'pending';
      manualReviewRequired = true;
    } else {
      verificationStatus = 'rejected';
    }
    
    // Store photo verification record
    const photoQuery = `
      INSERT INTO photo_verifications (
        trip_id, user_id, photo_url, photo_hash, exif_data,
        gps_coordinates, timestamp_taken, verification_status,
        confidence_score, manual_review_required, device_attestation, trace_id
      ) VALUES ($1, $2, $3, $4, $5, ST_GeomFromText('POINT($6 $7)', 4326), $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    
    const photoValues = [
      tripId, req.userId, photoUrl, photoHash,
      JSON.stringify({ ...exifData, vision_analysis: visionAnalysis }),
      exifData.gps.longitude, exifData.gps.latitude,
      exifData.timestamp, verificationStatus, combinedConfidence,
      manualReviewRequired, JSON.stringify({ device_attestation, location_context }),
      traceId
    ];
    
    const photoResult = await pool.query(photoQuery, photoValues);
    const photo = photoResult.rows[0];
    
    // Log audit event
    await pool.query(
      'SELECT log_audit_event($1, $2, $3, $4)',
      ['photo_uploaded', 'photo_verification', photo.id, JSON.stringify({
        verification_status: verificationStatus,
        confidence_score: combinedConfidence,
        location_context
      })]
    );
    
    res.status(201).json({
      photo_id: photo.id,
      trip_id: tripId,
      photo_url: photoUrl,
      verification_status: verificationStatus,
      confidence_score: combinedConfidence,
      manual_review_required: manualReviewRequired,
      gps_coordinates: {
        latitude: exifData.gps.latitude,
        longitude: exifData.gps.longitude
      },
      analysis: {
        type: visionAnalysis.type,
        description: visionAnalysis.description,
        confidence: visionAnalysis.confidence
      },
      uploaded_at: photo.created_at,
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error uploading photo:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// GET /api/v1/photos/:photoId/status - Get verification status
router.get('/:photoId/status', authenticateUser, [
  param('photoId').isUUID()
], async (req, res) => {
  try {
    const { photoId } = req.params;
    
    const query = `
      SELECT 
        id, verification_status, confidence_score, manual_review_required,
        approved_by, approved_at, created_at,
        ST_X(gps_coordinates) as longitude,
        ST_Y(gps_coordinates) as latitude
      FROM photo_verifications 
      WHERE id = $1 AND user_id = $2
    `;
    
    const result = await pool.query(query, [photoId, req.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photo verification not found' });
    }
    
    const photo = result.rows[0];
    
    res.json({
      photo_id: photoId,
      verification_status: photo.verification_status,
      confidence_score: photo.confidence_score,
      manual_review_required: photo.manual_review_required,
      gps_coordinates: {
        latitude: photo.latitude,
        longitude: photo.longitude
      },
      approved_by: photo.approved_by,
      approved_at: photo.approved_at,
      uploaded_at: photo.created_at
    });
    
  } catch (error) {
    console.error('Error getting photo status:', error);
    res.status(500).json({ error: 'Failed to get photo status' });
  }
});

// POST /api/v1/photos/:photoId/verify - Manual verification (admin only)
router.post('/:photoId/verify', authenticateUser, [
  param('photoId').isUUID(),
  body('approved').isBoolean(),
  body('admin_notes').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { photoId } = req.params;
    const { approved, admin_notes } = req.body;
    const traceId = req.headers['x-trace-id'] || uuidv4();
    
    // In production, verify admin role here
    const adminUserId = req.userId; // Simplified for MVP
    
    const status = approved ? 'approved' : 'rejected';
    
    const updateQuery = `
      UPDATE photo_verifications 
      SET verification_status = $1, approved_by = $2, approved_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [status, adminUserId, photoId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photo verification not found' });
    }
    
    // Log audit event
    await pool.query(
      'SELECT log_audit_event($1, $2, $3, $4)',
      ['photo_manually_verified', 'photo_verification', photoId, JSON.stringify({
        approved, admin_notes, admin_user: adminUserId
      })]
    );
    
    res.json({
      photo_id: photoId,
      verification_status: status,
      approved_by: adminUserId,
      approved_at: result.rows[0].approved_at,
      admin_notes,
      trace_id: traceId
    });
    
  } catch (error) {
    console.error('Error manually verifying photo:', error);
    res.status(500).json({ error: 'Failed to verify photo' });
  }
});

module.exports = router;
