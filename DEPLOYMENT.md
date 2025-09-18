# GoaGuide Monorepo Deployment Guide (Supabase + Railway + Vercel)

This repository is structured as a monorepo:

- `backend/` runs on Railway (Express API)
- `frontend/` runs on Vercel (Next.js 14)
- `supabase/` contains SQL schema and seed you can run in Supabase

The existing `railway.json` and `vercel.json` are already configured to deploy the respective folders.

Important: Do NOT commit secrets to git. Use environment variables only. If any secrets were formerly committed anywhere, rotate them immediately in dashboards.

---

## 1) Supabase Setup (Database + Auth)

1. Create a new project in Supabase
   - Project URL: visible in Settings > API > Project URL
   - anon/public key and service role key: visible in Settings > API

2. Enable extensions in the SQL editor (only run once):
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```

3. Create schema (use our ready SQL)
   - Open Supabase SQL Editor
   - Paste the contents of `supabase/migrations/001_initial_schema.sql`
   - Run it

4. (Optional) Seed sample data
   - Paste and run `supabase/seed.sql`

5. Get credentials for later steps
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never expose on frontend)

---

## 2) Backend on Railway (Express API)

The root `railway.json` already targets the `backend/` service.

Prerequisites
- Node.js 18+
- Railway CLI installed and logged in

Steps
1. From the repo root, link to your Railway project:
   ```bash
   railway login
   railway init  # if new
   railway link  # link to existing project
   ```

2. Set environment variables in Railway (recommended via dashboard). Minimum variables:
   - `DATABASE_URL` = Supabase pooled connection string (or direct DB URL)
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_ANON_KEY` = your anon key
   - `SUPABASE_SERVICE_KEY` = service role key (server-only)
   - `NODE_ENV` = production
   - `PORT` = 8080
   - `CORS_ORIGIN` = https://YOUR_FRONTEND.vercel.app (update after Vercel is live)
   - Any external API keys you plan to use (Maps, Weather, etc.)

   Example CLI (use your own values; do not paste secrets into git):
   ```bash
   railway variables set DATABASE_URL="postgresql://..."
   railway variables set SUPABASE_URL="https://xxxxxxxx.supabase.co"
   railway variables set SUPABASE_ANON_KEY="..."
   railway variables set SUPABASE_SERVICE_KEY="..."
   railway variables set NODE_ENV="production"
   railway variables set PORT="8080"
   railway variables set CORS_ORIGIN="https://YOUR_FRONTEND.vercel.app"
   ```

3. Deploy
   ```bash
   railway up
   ```

4. Verify
   - Open the Railway URL (e.g., `https://your-api.up.railway.app/health`)
   - You should see the JSON health response

5. Copy your API base URL for frontend
   - `NEXT_PUBLIC_API_URL` should be `https://your-api.up.railway.app/api/v1`

---

## 3) Frontend on Vercel (Next.js 14)

The root `vercel.json` routes all traffic into the `frontend/` folder and uses Vercel’s Next.js builder.

Steps
1. Push this repository to GitHub (see the last section). Then in Vercel:
   - Import your GitHub repo
   - Use default settings; `vercel.json` will take effect

2. Add environment variables in Vercel (Project Settings > Environment Variables):
   - `NEXT_PUBLIC_API_URL` = https://your-api.up.railway.app/api/v1
   - `NEXT_PUBLIC_SUPABASE_URL` = https://xxxxxxxx.supabase.co
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key

3. Deploy
   - Vercel will build and deploy automatically

4. Test
   - Open your Vercel URL (e.g., `https://your-frontend.vercel.app`)
   - Create a trip on the home page; it should call the Railway API

---

## 4) Local Development

Backend
```bash
# From repo root
cd backend
cp .env.example .env  # fill values
npm install
npm run start
# API at http://localhost:8080
```

Frontend
```bash
# From repo root
cd frontend
cp .env.example .env.local  # fill values
npm install
npm run dev
# Web at http://localhost:3000
```

Ensure `NEXT_PUBLIC_API_URL` points to `http://localhost:8080/api/v1` for local testing.

---

## 5) Push to GitHub and Connect Providers

Initialize repo and push
```bash
git init
git add .
git commit -m "GoaGuide monorepo: backend (Railway) + frontend (Vercel) + Supabase schema"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Then:
- Import repo in Vercel
- Link local to Railway (already done above)

---

## 6) Common Pitfalls and Fixes

- CORS blocked calls from frontend
  - Set `CORS_ORIGIN` in Railway to your Vercel frontend URL
- 404 from Vercel
  - Ensure `vercel.json` exists at repo root and `frontend/` has pages
- 500 from API
  - Check Railway logs and environment variables
- Supabase row-level security blocking reads
  - Confirm policies in `supabase/migrations/001_initial_schema.sql` are applied

---

## 7) Security Notes

- Never commit API keys. Use `.env`, Railway/Vercel dashboards
- If any keys were previously committed anywhere, rotate them in providers’ dashboards immediately
- Only use the anon key on the frontend; keep service key on the server only
