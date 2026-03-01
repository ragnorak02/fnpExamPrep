-- 002_create_daily_usage.sql
-- Creates the daily_usage table for tracking per-user daily question consumption.
-- Unique constraint on (user_id, day_iso) ensures one row per user per day.

CREATE TABLE daily_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_iso DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day_iso)
);

-- Enable Row Level Security
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;

-- Users can read their own usage records
CREATE POLICY "Users can read own usage"
  ON daily_usage FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated users.
-- Only Edge Functions using the service role key can create/update usage rows.
