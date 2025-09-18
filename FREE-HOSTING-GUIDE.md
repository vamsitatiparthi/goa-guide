# GoaGuide Free Hosting Deployment Guide

## 🚀 Free Hosting Options for GoaGuide

### Recommended Free Hosting Stack

| Component | Service | Free Tier Limits | Cost After Free |
|-----------|---------|------------------|-----------------|
| **Frontend** | Vercel/Netlify | 100GB bandwidth, unlimited sites | $20/month |
| **Backend API** | Railway | 500 hours/month, 1GB RAM | $5/month |
| **Database** | Supabase | 500MB, 2 concurrent connections | $25/month |
| **File Storage** | Cloudinary | 25GB storage, 25GB bandwidth | $99/month |
| **Authentication** | Supabase Auth | Unlimited users | Free forever |
| **Monitoring** | Railway Metrics | Basic metrics included | Free |

**Total Monthly Cost After Free Tier: ~$149/month** (but you get months of free usage first!)

## 📋 Step-by-Step Deployment Process

### Phase 1: Setup Accounts (5 minutes)

1. **Create Accounts** (all free):
   ```bash
   # Required accounts
   - GitHub account (for code repository)
   - Railway account (backend hosting)
   - Vercel account (frontend hosting)  
   - Supabase account (database + auth)
   - Cloudinary account (image storage)
   ```

2. **Install Required Tools**:
   ```bash
   # Install Node.js 18+
   node --version  # Should be 18+
   
   # Install Railway CLI
   npm install -g @railway/cli
   
   # Install Vercel CLI
   npm install -g vercel
   ```

### Phase 2: Database Setup (10 minutes)

1. **Setup Supabase Database**:
   ```bash
   # Go to https://supabase.com
   # Create new project: "goaguide-db"
   # Note down (from Settings > Database and Settings > API):
   # - Database URL (do NOT commit)
   # - Project URL (NEXT_PUBLIC_SUPABASE_URL)
   # - anon/public key (NEXT_PUBLIC_SUPABASE_ANON_KEY) — frontend safe
   # - Service Role Key (SUPABASE_SERVICE_ROLE_KEY) — server only, never commit
   ```

2. **Enable PostGIS Extension**:
   ```sql
   -- Run in Supabase SQL Editor
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```

3. **Create Core Tables**:
   ```sql
   -- Copy from our schema files (coming next)
   ```

### Phase 3: Backend Deployment (15 minutes)

1. **Prepare Railway Deployment**:
   ```bash
   # In your goaguide directory
   railway login
   railway init
   railway link  # Link to your Railway project
   ```  
<!-- Redacted previous project URL/ID. Use your own Railway project and keep IDs secret. -->
2. **Environment Variables Setup**:
   ```bash 
    # Set in Railway dashboard (use your own values; do NOT paste real secrets into this file)
   DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
   JWT_SECRET=<a-strong-random-256-bit-secret>
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_ANON_KEY=<your-anon-key>
   SUPABASE_SERVICE_KEY=<your-service-role-key>
   WEATHER_API_KEY=<your-weather-api-key>
   MAPS_API_KEY=<your-google-maps-api-key>
   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
   NODE_ENV=production
   PORT=8080
   ```
   <!-- Redacted previously committed Cloudinary URL. Replace with your own in env only. -->

3. **Deploy Backend**:
   ```bash
   # Deploy to Railway
   railway up
   
   # Your API will be available at:
   # https://your-app-name.up.railway.app
   ```

   >> Set up your project locally
    Install the Railway CLI, then link to your own project via dashboard or CLI.

### Phase 4: Frontend Deployment (10 minutes)

1. **Setup Vercel Deployment**:
   ```bash
   # In your web-app directory
   vercel login
   vercel --prod
   
   # Set environment variables in Vercel dashboard:
   NEXT_PUBLIC_API_URL=https://your-railway-app.up.railway.app
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

2. **Your website will be live at**:
   ```
   https://your-app-name.vercel.app
   ```

## 🏗️ Simplified MVP Architecture for Free Hosting

```mermaid
graph TB
    subgraph "Free Tier Stack"
        VERCEL[Vercel Frontend<br/>React App]
        RAILWAY[Railway Backend<br/>Node.js API]
        SUPABASE[(Supabase<br/>PostgreSQL + Auth)]
        CLOUDINARY[Cloudinary<br/>Image Storage]
    end
    
    subgraph "External APIs"
        WEATHER[OpenWeather API<br/>Free 1000 calls/day]
        MAPS[Google Maps API<br/>$200 credit/month]
        LLM[OpenAI API<br/>Pay per use]
    end
    
    VERCEL --> RAILWAY
    RAILWAY --> SUPABASE
    RAILWAY --> CLOUDINARY
    RAILWAY --> WEATHER
    RAILWAY --> MAPS
    RAILWAY --> LLM
```

## 📁 Simplified Project Structure for MVP

```
goaguide-mvp/
├── backend/                 # Railway deployment
│   ├── package.json
│   ├── server.js           # Main Express server
│   ├── routes/
│   │   ├── trips.js
│   │   ├── itinerary.js
│   │   └── events.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── validation.js
│   └── utils/
│       ├── database.js
│       └── llm.js
├── frontend/               # Vercel deployment
│   ├── package.json
│   ├── pages/
│   ├── components/
│   └── styles/
├── database/
│   └── schema.sql         # Supabase setup
└── docs/
    └── deployment.md
```

## 🔧 Essential Environment Variables

### Backend (.env)
```bash
# Database
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
SUPABASE_URL=https://[project].supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Authentication
JWT_SECRET=your-256-bit-secret-key-here
SUPABASE_ANON_KEY=eyJ...

# External APIs
OPENWEATHER_API_KEY={{OPENWEATHER_API_KEY}}
GOOGLE_MAPS_API_KEY={{GOOGLE_MAPS_API_KEY}}
OPENAI_API_KEY={{OPENAI_API_KEY}}

# File Storage
CLOUDINARY_URL=cloudinary://123456789012345:abcdefghijklmnopqrstuvwxyz@your-cloud-name

# App Config
NODE_ENV=production
PORT=8080
CORS_ORIGIN=https://your-app.vercel.app
```

### Frontend (.env.local)
```bash
NEXT_PUBLIC_API_URL=https://your-app.up.railway.app
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY={{GOOGLE_MAPS_API_KEY}}
```

## 🎯 Free Tier Optimization Tips

### 1. Database Optimization
```sql
-- Use efficient indexes
CREATE INDEX idx_trips_user_id ON trips(user_id);
CREATE INDEX idx_events_location ON events USING GIST(location);
CREATE INDEX idx_events_date ON events(start_date, end_date);

-- Implement connection pooling
-- Use Supabase's built-in connection pooling
```

### 2. API Rate Limiting
```javascript
// Implement caching to reduce API calls
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes

// Cache weather data
app.get('/api/weather/:city', async (req, res) => {
  const cached = cache.get(`weather_${req.params.city}`);
  if (cached) return res.json(cached);
  
  // Fetch from API only if not cached
  const weather = await fetchWeather(req.params.city);
  cache.set(`weather_${req.params.city}`, weather);
  res.json(weather);
});
```

### 3. Image Optimization
```javascript
// Use Cloudinary transformations
const imageUrl = cloudinary.url('sample.jpg', {
  width: 400,
  height: 300,
  crop: 'fill',
  quality: 'auto',
  format: 'auto'
});
```

## 📊 Monitoring Free Usage

### Railway Monitoring
```bash
# Check usage
railway status
railway logs

# Monitor metrics in Railway dashboard:
# - CPU usage
# - Memory usage
# - Network usage
# - Build minutes
```

### Supabase Monitoring
```sql
-- Check database size
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## 🚨 When You'll Need to Upgrade

### Railway ($5/month)
- When you exceed 500 hours/month (about 16 hours/day)
- When you need more than 1GB RAM
- When you need custom domains

### Supabase ($25/month)
- When you exceed 500MB database size
- When you need more than 2 concurrent connections
- When you need daily backups

### Vercel ($20/month)
- When you exceed 100GB bandwidth
- When you need advanced analytics
- When you need password protection

## 🎉 Your GoaGuide Will Work Perfectly!

**Yes, GoaGuide will work excellently with this setup because:**

1. **Scalable Architecture**: Designed for cloud-native deployment
2. **Modern Tech Stack**: React + Node.js + PostgreSQL is battle-tested
3. **API-First Design**: Easy to scale and maintain
4. **Feature Flags**: Can disable expensive features on free tier
5. **Caching Strategy**: Reduces API calls and database queries
6. **Optimized Queries**: PostGIS spatial queries are efficient
7. **Stateless Design**: Perfect for serverless/container deployment

**Free tier limitations you can work around:**
- Start with fewer LLM calls (cache responses)
- Limit photo uploads initially
- Use simpler itinerary algorithms
- Implement basic event ingestion first

**You'll get months of free usage** before needing to upgrade, giving you time to validate the product and potentially generate revenue!

## 🚀 Quick Start Commands

```bash
# 1. Clone and setup
git clone <your-repo>
cd goaguide-mvp

# 2. Setup backend
cd backend
npm install
railway login
railway up

# 3. Setup frontend  
cd ../frontend
npm install
vercel --prod

# 4. Setup database
# Run schema.sql in Supabase dashboard

# 5. Test everything
curl https://your-app.up.railway.app/health
```

Your GoaGuide will be live and working within 30 minutes! 🎯
