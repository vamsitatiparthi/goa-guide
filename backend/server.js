const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
/*const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});*/
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Trust proxy for correct client IPs behind proxies (Railway/Vercel)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(compression());
// CORS with multi-origin support via comma-separated CORS_ORIGIN
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser tools
    const ok = allowedOrigins.includes(origin);
    return callback(null, ok);
  },
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// DB health and schema checks
app.get('/health/db', async (req, res) => {
  try {
    const now = await pool.query('select now() as now');
    const tripsTable = await pool.query(
      `select to_regclass('public.trips') as trips_exists, to_regclass('public.consent_records') as consent_exists`
    );
    res.json({
      db_connected: true,
      now: now.rows[0].now,
      schema: tripsTable.rows[0],
    });
  } catch (e) {
    console.error('DB health error:', e);
    res.status(500).json({ db_connected: false, error: e.message });
  }
});

// API Routes
app.use('/api/v1/trips', require('./routes/trips'));
app.use('/api/v1/itinerary', require('./routes/itinerary'));
app.use('/api/v1/events', require('./routes/events'));
app.use('/api/v1/bookings', require('./routes/bookings'));
app.use('/api/v1/photos', require('./routes/photos'));
app.use('/provider/api/v1', require('./routes/provider'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      ...(isDevelopment && { stack: err.stack }),
      trace_id: req.headers['x-trace-id'] || 'unknown'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      path: req.originalUrl,
      method: req.method
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 GoaGuide API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
