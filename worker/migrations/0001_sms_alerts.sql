CREATE TABLE IF NOT EXISTS sms_subscriptions (
    id INTEGER PRIMARY KEY,
    phone_e164 TEXT NOT NULL,
    latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    radius_km REAL NOT NULL CHECK (radius_km > 0),
    consented_at TEXT NOT NULL,
    unsubscribed_at TEXT,
    UNIQUE (phone_e164, latitude, longitude, radius_km)
);

CREATE TABLE IF NOT EXISTS sms_alerts (
    subscription_id INTEGER NOT NULL REFERENCES sms_subscriptions(id),
    detection_key TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    twilio_message_sid TEXT UNIQUE,
    PRIMARY KEY (subscription_id, detection_key)
);

CREATE TABLE IF NOT EXISTS sms_send_cooldowns (
    phone_e164 TEXT NOT NULL PRIMARY KEY,
    next_allowed_at_ms INTEGER NOT NULL
);
