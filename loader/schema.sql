-- Wearable Coach schema (SPEC §6.2).
-- Dates are local calendar dates. Durations in minutes, distances in km, HR in bpm.

CREATE TABLE IF NOT EXISTS daily (
  date DATE PRIMARY KEY,
  resting_hr INT, min_hr INT, max_hr INT,
  steps INT, intensity_minutes INT,
  avg_stress INT,                            -- 0-100 Garmin scale
  body_battery_high INT, body_battery_low INT,
  active_calories INT,
  source VARCHAR DEFAULT 'garmin', loaded_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sleep (
  date DATE PRIMARY KEY,                     -- calendar date the sleep is displayed on
  sleep_start TIMESTAMP, sleep_end TIMESTAMP,
  total_min INT, deep_min INT, light_min INT, rem_min INT, awake_min INT,
  sleep_score INT,                           -- 0-100
  avg_spo2 DOUBLE, avg_respiration DOUBLE,
  validation VARCHAR,                        -- MANUAL | DEVICE | OFF_WRIST | AUTO_TENTATIVE | ENHANCED_TENTATIVE | ENHANCED_FINAL ...
  source VARCHAR DEFAULT 'garmin', loaded_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hrv (
  date DATE PRIMARY KEY,
  last_night_avg INT, last_night_5min_high INT,
  weekly_avg INT,
  status VARCHAR,                            -- BALANCED | UNBALANCED | LOW | POOR | NONE
  baseline_low INT, baseline_high INT,
  source VARCHAR DEFAULT 'garmin', loaded_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activities (
  activity_id BIGINT PRIMARY KEY,
  start_time TIMESTAMP,
  type VARCHAR,                              -- running | walking | cycling | strength_training | swimming | ...
  duration_min DOUBLE, distance_km DOUBLE,
  avg_hr INT, max_hr INT, calories INT,
  aerobic_te DOUBLE, anaerobic_te DOUBLE,    -- Garmin training effect 0-5
  recovery_time_hours INT,
  avg_speed_kmh DOUBLE, elevation_gain_m DOUBLE,
  hard_minutes DOUBLE,                       -- minutes at or above HR zone 4 (SPEC §6.3)
  source VARCHAR DEFAULT 'garmin', loaded_at TIMESTAMP
);

-- Added after the real export showed it carries no numeric training effect.
-- Idempotent, so existing databases pick the column up on the next load.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS hard_minutes DOUBLE;

CREATE TABLE IF NOT EXISTS user_metrics (
  date DATE, metric VARCHAR, value DOUBLE,   -- metric IN ('vo2max', 'fitness_age')
  source VARCHAR DEFAULT 'garmin', loaded_at TIMESTAMP,
  PRIMARY KEY (date, metric)
);

-- Loader bookkeeping: every source field we could not map (SPEC §6.2 "don't silently drop").
CREATE TABLE IF NOT EXISTS load_log (
  loaded_at TIMESTAMP,
  table_name VARCHAR,
  file VARCHAR,
  records_seen INT,
  records_written INT,
  unmapped_fields VARCHAR                    -- comma-separated
);
