CREATE TRIGGER IF NOT EXISTS reserve_firms_sms_cooldown
AFTER INSERT ON sms_alerts
WHEN NEW.detection_key GLOB 'firms:v1:*'
BEGIN
    INSERT INTO sms_send_cooldowns (phone_e164, next_allowed_at_ms)
    VALUES (
        (SELECT phone_e164 FROM sms_subscriptions WHERE id = NEW.subscription_id),
        (unixepoch('now') + 3600) * 1000
    )
    ON CONFLICT (phone_e164) DO UPDATE
    SET next_allowed_at_ms = excluded.next_allowed_at_ms;
END;
