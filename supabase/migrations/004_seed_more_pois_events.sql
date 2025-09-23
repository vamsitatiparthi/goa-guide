-- 004_seed_more_pois_events.sql
-- Adds additional POIs and Events for Goa to provide more variety in itineraries

-- Ensure PostGIS is available
CREATE EXTENSION IF NOT EXISTS postgis;

-- POIs: a broader, diverse set
INSERT INTO public.pois (name, description, category, price_range, rating, location, address, website, images)
VALUES
  ('Baga Beach', 'Lively beach with shacks and water sports.', 'beach', 'free', 4.2,
   ST_SetSRID(ST_GeomFromText('POINT(73.7415 15.5553)'), 4326),
   'Baga, Goa', 'https://www.goa-tourism.com',
   ARRAY['https://images.unsplash.com/photo-1504185945330-7a5d61b8b67a']),
  ('Calangute Beach', 'The “Queen of Beaches” with many activities.', 'beach', 'free', 4.1,
   ST_SetSRID(ST_GeomFromText('POINT(73.7620 15.5499)'), 4326),
   'Calangute, Goa', 'https://www.goa-tourism.com',
   ARRAY['https://images.unsplash.com/photo-1493558103817-58b2924bce98']),
  ('Old Goa Churches', 'UNESCO heritage churches and convents.', 'historical', 'free', 4.6,
   ST_SetSRID(ST_GeomFromText('POINT(73.9125 15.5030)'), 4326),
   'Old Goa', 'https://www.goa-tourism.com',
   ARRAY['https://images.unsplash.com/photo-1582719471384-894fbb16e074']),
  ('Spice Farm Tour', 'Guided plantation tour with lunch options.', 'nature', 'mid_range', 4.3,
   ST_SetSRID(ST_GeomFromText('POINT(74.0010 15.3360)'), 4326),
   'Ponda, Goa', 'https://www.sahakarifarms.com',
   ARRAY['https://images.unsplash.com/photo-1524592870426-59f2d2e24f1b']),
  ('Saturday Night Market', 'Night market with food, music, crafts.', 'entertainment', 'budget', 4.0,
   ST_SetSRID(ST_GeomFromText('POINT(73.7660 15.5950)'), 4326),
   'Arpora, Goa', 'https://www.goa-tourism.com',
   ARRAY['https://images.unsplash.com/photo-1498654200943-1088dd4438ae']),
  ('Dudhsagar Trek', 'Scenic trek to the famous waterfalls.', 'adventure', 'mid_range', 4.4,
   ST_SetSRID(ST_GeomFromText('POINT(74.3146 15.3140)'), 4326),
   'Sonaulim, Goa', 'https://www.goa-tourism.com',
   ARRAY['https://images.unsplash.com/photo-1500530855697-b586d89ba3ee'])
ON CONFLICT DO NOTHING;

-- Events in next 30 days
INSERT INTO public.events (title, description, start_date, location, price, curator_approved)
VALUES
  ('Beach Music Fest', 'Live music at the beach with local bands.', NOW() + INTERVAL '5 days',
   ST_SetSRID(ST_GeomFromText('POINT(73.7415 15.5553)'), 4326), 0, TRUE),
  ('Latin Night', 'Dance and culture evening in Panaji.', NOW() + INTERVAL '10 days',
   ST_SetSRID(ST_GeomFromText('POINT(73.8278 15.4909)'), 4326), 200, TRUE),
  ('Food Carnival', 'Taste local Goan cuisine and fusion dishes.', NOW() + INTERVAL '14 days',
   ST_SetSRID(ST_GeomFromText('POINT(73.8046 15.4696)'), 4326), 100, TRUE),
  ('Artisanal Flea Market', 'Handmade crafts and souvenirs.', NOW() + INTERVAL '7 days',
   ST_SetSRID(ST_GeomFromText('POINT(73.7660 15.5950)'), 4326), 0, TRUE)
ON CONFLICT DO NOTHING;

-- Verification queries (no-op in prod, useful when running manually)
-- SELECT COUNT(*) AS poi_count FROM public.pois;
-- SELECT COUNT(*) AS event_count FROM public.events;
