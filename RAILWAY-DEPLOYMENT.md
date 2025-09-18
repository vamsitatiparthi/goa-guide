# Railway Deployment Commands for GoaGuide

## 🚂 Step-by-Step Railway Deployment

### 1. Install Railway CLI (if not already installed)
```bash
# Windows (PowerShell)
iwr -useb https://railway.com/install.ps1 | iex

# Or using curl
curl -fsSL https://railway.com/install.sh | sh
```

### 2. Login and Link to Your Project
```bash
# Login to Railway
railway login

# Link to your existing project (use your own project ID from Railway dashboard)
# Avoid committing project IDs
railway link
```

### 3. Set Environment Variables
```bash
# Navigate to backend directory
cd backend

# Set all required environment variables
railway variables set DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db>"

railway variables set SUPABASE_URL="https://<your-project>.supabase.co"

railway variables set SUPABASE_ANON_KEY="<your-anon-key>"

railway variables set JWT_SECRET="<your-256-bit-secret>"

railway variables set OPENWEATHER_API_KEY="<your-weather-key>"

railway variables set GOOGLE_MAPS_API_KEY="<your-google-maps-key>"

railway variables set CLOUDINARY_URL="cloudinary://<api_key>:<api_secret>@<cloud_name>"

railway variables set NODE_ENV="production"

railway variables set PORT="8080"

railway variables set CORS_ORIGIN="https://your-frontend-app.vercel.app"
```

### 4. Deploy Backend
```bash
# Make sure you're in the backend directory
cd backend

# Deploy to Railway
railway up

# Or if you want to deploy and follow logs
railway up --detach=false
```

### 5. Get Your Deployed URL
```bash
# Get the deployment URL
railway status

# Or open in browser
railway open
```

## 🔍 Verify Deployment

### Check Health Endpoint
```bash
# Test your deployed API
curl https://your-app-name.up.railway.app/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2024-01-15T10:30:00Z",
#   "version": "1.0.0",
#   "environment": "production"
# }
```

### Test API Endpoints
```bash
# Test trip creation
curl -X POST https://your-app-name.up.railway.app/api/v1/trips \
  -H "Content-Type: application/json" \
  -H "x-user-id: <test-user-id>" \
  -d '{
    "destination": "Goa",
    "input_text": "I want to go to Goa for 2 days with my family",
    "party_size": 4,
    "trip_type": "family"
  }'
```

## 🐛 Troubleshooting

### View Logs
```bash
# View real-time logs
railway logs

# View logs with follow
railway logs --follow
```

### Check Variables
```bash
# List all environment variables
railway variables

# Check specific variable
railway variables get DATABASE_URL
```

### Redeploy if Needed
```bash
# Force redeploy
railway up --force

# Or redeploy with specific service
railway redeploy
```

## 📝 Important Notes

1. **Database Connection**: Your Supabase database should be accessible from Railway
2. **CORS Origin**: Update `CORS_ORIGIN` with your actual Vercel frontend URL after frontend deployment
3. **API Keys**: All your API keys are set, but make sure they're active and have proper quotas
4. **Health Check**: Railway will use `/health` endpoint to monitor your service

## 🎯 Next Steps After Backend Deployment

1. Note down your Railway app URL (e.g., `https://goaguide-backend-production.up.railway.app`)
2. Use this URL as `NEXT_PUBLIC_API_URL` for your Vercel frontend deployment
3. Test all endpoints to ensure they're working correctly
4. Update CORS_ORIGIN after frontend deployment

Your backend should be live at: `https://[your-app-name].up.railway.app`

Note: If any credentials/keys were previously visible in this repository, rotate them immediately in Supabase, Google Cloud (Maps), Cloudinary, and any other providers.
