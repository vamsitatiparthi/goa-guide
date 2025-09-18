-- GoaGuide Database Schema
-- PostgreSQL 14+ with PostGIS extension required

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create custom types
CREATE TYPE trip_status AS ENUM ('created', 'questions_pending', 'generating', 'ready', 'booked');
CREATE TYPE booking_status AS ENUM ('hold', 'confirmed', 'cancelled', 'refunded');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE verification_status AS ENUM ('uploaded', 'verifying', 'verified', 'rejected', 'manual_review');
CREATE TYPE event_category AS ENUM ('festival', 'market', 'party', 'cultural', 'sports', 'food');
CREATE TYPE provider_status AS ENUM ('pending', 'approved', 'suspended', 'rejected');

-- Core Tables

-- Users table
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    consent_tokens JSONB DEFAULT '[]'::jsonb
);

-- Trips table
CREATE TABLE trips (
    trip_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id),
    destination VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    status trip_status DEFAULT 'created',
    dates JSONB, -- {start_date, end_date}
    party_composition JSONB, -- {adults, children, infants}
    budget_per_person DECIMAL(10,2),
    preferences JSONB DEFAULT '[]'::jsonb,
    follow_up_questions JSONB DEFAULT '[]'::jsonb,
    answers JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Points of Interest with PostGIS
CREATE TABLE pois (
    poi_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    location GEOMETRY(POINT, 4326) NOT NULL,
    address TEXT,
    opening_hours JSONB,
    price_range JSONB, -- {min, max, currency}
    rating DECIMAL(3,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Spatial index for POIs
CREATE INDEX idx_pois_location ON pois USING GIST (location);

-- Itineraries
CREATE TABLE itineraries (
    itinerary_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID REFERENCES trips(trip_id),
    status VARCHAR(20) DEFAULT 'generated',
    budget_status VARCHAR(20) DEFAULT 'within_budget',
    total_cost DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'INR',
    days JSONB NOT NULL, -- Array of day objects with activities
    alternatives JSONB DEFAULT '[]'::jsonb,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    version INTEGER DEFAULT 1
);

-- Events with geospatial support
CREATE TABLE events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category event_category,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    location GEOMETRY(POINT, 4326),
    address TEXT,
    price_range JSONB, -- {min, max, currency}
    confidence_score DECIMAL(3,2) DEFAULT 0.5,
    source VARCHAR(100),
    impact_level VARCHAR(10) DEFAULT 'low',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Spatial and temporal indexes for events
CREATE INDEX idx_events_location ON events USING GIST (location);
CREATE INDEX idx_events_dates ON events (start_date, end_date);
CREATE INDEX idx_events_category ON events (category);

-- Providers
CREATE TABLE providers (
    provider_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(20),
    address TEXT,
    location GEOMETRY(POINT, 4326),
    status provider_status DEFAULT 'pending',
    kyc_documents JSONB DEFAULT '[]'::jsonb,
    services JSONB DEFAULT '[]'::jsonb,
    api_key VARCHAR(64) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RFPs (Request for Proposals)
CREATE TABLE rfps (
    rfp_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID REFERENCES trips(trip_id),
    anonymized_profile JSONB NOT NULL,
    activities_requested JSONB NOT NULL,
    response_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_to_providers UUID[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Provider Offers
CREATE TABLE offers (
    offer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rfp_id UUID REFERENCES rfps(rfp_id),
    provider_id UUID REFERENCES providers(provider_id),
    activities JSONB NOT NULL,
    total_cost DECIMAL(10,2) NOT NULL,
    validity_hours INTEGER DEFAULT 24,
    terms_conditions TEXT,
    status VARCHAR(20) DEFAULT 'submitted',
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Bookings
CREATE TABLE bookings (
    booking_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID REFERENCES trips(trip_id),
    user_id UUID REFERENCES users(user_id),
    activities JSONB NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    status booking_status DEFAULT 'hold',
    payment_status payment_status DEFAULT 'pending',
    payment_method VARCHAR(20),
    consent_token VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    confirmation_deadline TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Photo Verification
CREATE TABLE photo_verifications (
    photo_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID REFERENCES trips(trip_id),
    activity_id VARCHAR(255),
    file_path VARCHAR(500) NOT NULL,
    status verification_status DEFAULT 'uploaded',
    verification_score DECIMAL(3,2),
    exif_data JSONB,
    location_claimed GEOMETRY(POINT, 4326),
    location_verified GEOMETRY(POINT, 4326),
    issues JSONB DEFAULT '[]'::jsonb,
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit Logs (Immutable)
CREATE TABLE audit_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trace_id VARCHAR(50) NOT NULL,
    service_name VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(255),
    user_id UUID,
    payload_hash VARCHAR(64),
    feature_flags_snapshot JSONB,
    consent_snapshot JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Make audit_logs append-only
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- Feature Flags
CREATE TABLE feature_flags (
    flag_name VARCHAR(100) PRIMARY KEY,
    enabled BOOLEAN DEFAULT false,
    description TEXT,
    conditions JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID
);

-- LLM Cache
CREATE TABLE llm_cache (
    cache_key VARCHAR(64) PRIMARY KEY,
    prompt_hash VARCHAR(64) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    response JSONB NOT NULL,
    cost DECIMAL(10,4),
    tokens_used INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Sample Data Inserts

-- Insert default feature flags
INSERT INTO feature_flags (flag_name, enabled, description) VALUES
('events_ingest', true, 'Enable event data ingestion'),
('provider_rfp', true, 'Enable provider RFP system'),
('auto_book', false, 'Enable automatic booking confirmation'),
('adventure_validator', true, 'Enable adventure photo validation'),
('photo_verification', true, 'Enable photo authenticity checks'),
('llm_orchestration', true, 'Enable LLM orchestrator service'),
('audit_logging', true, 'Enable audit logging'),
('api_gateway', true, 'Enable API gateway features');

-- Insert sample POIs in Goa
INSERT INTO pois (name, description, category, location, address, price_range) VALUES
('Baga Beach', 'Popular beach with water sports and nightlife', 'beach', ST_SetSRID(ST_MakePoint(73.7516, 15.5557), 4326), 'Baga, Goa', '{"min": 0, "max": 2000, "currency": "INR"}'),
('Basilica of Bom Jesus', 'UNESCO World Heritage Site church', 'cultural', ST_SetSRID(ST_MakePoint(73.9115, 15.5007), 4326), 'Old Goa', '{"min": 0, "max": 50, "currency": "INR"}'),
('Dudhsagar Falls', 'Four-tiered waterfall in Bhagwan Mahaveer Sanctuary', 'nature', ST_SetSRID(ST_MakePoint(74.3144, 15.3144), 4326), 'Mollem, Goa', '{"min": 500, "max": 3000, "currency": "INR"}'),
('Anjuna Flea Market', 'Weekly market with local crafts and food', 'market', ST_SetSRID(ST_MakePoint(73.7395, 15.5735), 4326), 'Anjuna, Goa', '{"min": 100, "max": 5000, "currency": "INR"}');

-- Insert sample events
INSERT INTO events (title, description, category, start_date, end_date, location, confidence_score, source) VALUES
('Sunburn Festival', 'Electronic dance music festival', 'festival', '2024-12-28 18:00:00+05:30', '2024-12-30 06:00:00+05:30', ST_SetSRID(ST_MakePoint(73.7516, 15.5557), 4326), 0.95, 'official_website'),
('Saturday Night Market', 'Weekly night market at Arpora', 'market', '2024-12-14 19:00:00+05:30', '2024-12-15 01:00:00+05:30', ST_SetSRID(ST_MakePoint(73.7395, 15.5735), 4326), 0.85, 'municipal_calendar');

-- Create indexes for performance
CREATE INDEX idx_trips_user_id ON trips(user_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_bookings_user_id ON bookings(user_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_audit_logs_trace_id ON audit_logs(trace_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_llm_cache_expires_at ON llm_cache(expires_at);

-- Create functions for common queries

-- Function to search events by location and date
CREATE OR REPLACE FUNCTION search_events(
    search_lat DECIMAL,
    search_lng DECIMAL,
    search_radius_km INTEGER DEFAULT 10,
    search_date DATE DEFAULT NULL
)
RETURNS TABLE (
    event_id UUID,
    title VARCHAR,
    category event_category,
    start_date TIMESTAMP WITH TIME ZONE,
    distance_km DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.event_id,
        e.title,
        e.category,
        e.start_date,
        ROUND(ST_Distance(e.location, ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326))::geography / 1000, 2) as distance_km
    FROM events e
    WHERE ST_DWithin(
        e.location::geography,
        ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
        search_radius_km * 1000
    )
    AND (search_date IS NULL OR DATE(e.start_date) = search_date)
    ORDER BY distance_km;
END;
$$ LANGUAGE plpgsql;

-- Function to find nearby POIs
CREATE OR REPLACE FUNCTION find_nearby_pois(
    search_lat DECIMAL,
    search_lng DECIMAL,
    search_radius_km INTEGER DEFAULT 5,
    poi_category VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    poi_id UUID,
    name VARCHAR,
    category VARCHAR,
    distance_km DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.poi_id,
        p.name,
        p.category,
        ROUND(ST_Distance(p.location, ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326))::geography / 1000, 2) as distance_km
    FROM pois p
    WHERE ST_DWithin(
        p.location::geography,
        ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
        search_radius_km * 1000
    )
    AND (poi_category IS NULL OR p.category = poi_category)
    ORDER BY distance_km;
END;
$$ LANGUAGE plpgsql;
