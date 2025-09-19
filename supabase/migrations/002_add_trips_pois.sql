-- 002_add_trips_pois.sql
-- Adds missing tables used by backend routes: trips and pois
-- Also aligns events table with backend queries by adding curator_approved

-- Extensions (safe to re-run)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create trips table
-- Note: backend uses arbitrary header value 'x-user-id' as req.userId (string)
-- so we store user_id as TEXT (not FK). Adjust later if you wire real auth.
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  destination TEXT DEFAULT 'Goa',
  party_size INTEGER DEFAULT 1 CHECK (party_size >= 1),
  trip_type TEXT DEFAULT 'solo',
  budget_per_person INTEGER DEFAULT 5000 CHECK (budget_per_person >= 0),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','ready','completed','cancelled')),
  questionnaire_responses JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Update trigger for trips.updated_at
CREATE OR REPLACE FUNCTION public._set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trips_updated_at ON public.trips;
CREATE TRIGGER trg_trips_updated_at
BEFORE UPDATE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- Create pois table (Points of Interest)
-- Backend query uses geometry(Point,4326) with ST_GeomFromText and ST_DWithin
CREATE TABLE IF NOT EXISTS public.pois (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- e.g., 'beach','historical','religious','adventure','entertainment','nature','market','shopping','indoor','outdoor'
  price_range TEXT DEFAULT 'budget' CHECK (price_range IN ('free','budget','mid_range','luxury')),
  rating NUMERIC(2,1) DEFAULT 4.0 CHECK (rating >= 0 AND rating <= 5),
  location geometry(Point,4326),
  address TEXT,
  website TEXT,
  phone TEXT,
  images TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_pois_updated_at ON public.pois;
CREATE TRIGGER trg_pois_updated_at
BEFORE UPDATE ON public.pois
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_pois_category ON public.pois(category);
CREATE INDEX IF NOT EXISTS idx_pois_rating ON public.pois(rating);
CREATE INDEX IF NOT EXISTS idx_pois_location ON public.pois USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON public.trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON public.trips(status);

-- Align events table with backend: add curator_approved boolean if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'curator_approved'
  ) THEN
    ALTER TABLE public.events ADD COLUMN curator_approved BOOLEAN DEFAULT TRUE;
    CREATE INDEX IF NOT EXISTS idx_events_curator_approved ON public.events(curator_approved);
  END IF;
END $$;

-- Seed a minimal set of POIs around Panaji, Goa (optional)
INSERT INTO public.pois (name, description, category, price_range, rating, location, address, website, images)
VALUES
  (
    'Miramar Beach',
    'City beach near Panaji with calm waters and golden sands.',
    'beach', 'free', 4.1,
    ST_SetSRID(ST_GeomFromText('POINT(73.8046 15.4696)'), 4326),
    'Panaji, Goa 403001',
    'https://www.goa-tourism.com',
    ARRAY['https://images.unsplash.com/photo-1507525428034-b723cf961d3e']
  ),
  (
    'Dona Paula Viewpoint',
    'Famous viewpoint with Arabian Sea vistas and breeze.',
    'nature', 'free', 4.2,
    ST_SetSRID(ST_GeomFromText('POINT(73.8060 15.4612)'), 4326),
    'Dona Paula, Goa 403004',
    'https://www.goa-tourism.com',
    ARRAY['https://images.unsplash.com/photo-1493558103817-58b2924bce98']
  ),
  (
    'Basilica of Bom Jesus (POI)',
    'UNESCO heritage site with baroque architecture.',
    'historical', 'free', 4.5,
    ST_SetSRID(ST_GeomFromText('POINT(73.9115 15.5009)'), 4326),
    'Old Goa, Goa 403402',
    'https://www.goa-tourism.com',
    ARRAY['https://images.unsplash.com/photo-1582719471384-894fbb16e074']
  )
ON CONFLICT DO NOTHING;

-- Optional: simple RLS policies (if you enable RLS). Since backend uses direct DB connection, RLS is typically not required here.
-- ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.pois ENABLE ROW LEVEL SECURITY;

-- Example basic policies (commented out)
-- CREATE POLICY trips_owner_select ON public.trips FOR SELECT USING (true);
-- CREATE POLICY pois_public_select ON public.pois FOR SELECT USING (true);
