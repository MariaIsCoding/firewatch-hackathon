const SATELLITES = {
  MODIS: "MODIS_NRT",
  NOAA20: "VIIRS_NOAA20_NRT",
  NOAA21: "VIIRS_NOAA21_NRT",
};

const MAX_MAP_DETECTIONS = 5000;
const FIRMS_CSV_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/";
const MAP_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=900",
};

function hasDemoToken(request, env) {
  return request.headers.get("Authorization") === `Bearer ${env.DEMO_ALERT_TOKEN}`;
}

function distanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * radians;
  const longitudeDelta = (longitudeB - longitudeA) * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA * radians) *
      Math.cos(latitudeB * radians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function isWithinRadius(distance, subscription) {
  return distance <= subscription.radius_km;
}

async function recordMatchingAlert(db, subscription, hotspot) {
  const distance = distanceKm(
    subscription.latitude,
    subscription.longitude,
    hotspot.latitude,
    hotspot.longitude,
  );

  if (!isWithinRadius(distance, subscription)) {
    return { distanceKm: distance, withinRadius: false, inserted: 0 };
  }

  const result = await db.prepare(`
    INSERT INTO sms_alerts (subscription_id, detection_key)
    VALUES (?, ?)
    ON CONFLICT (subscription_id, detection_key) DO NOTHING
  `)
    .bind(subscription.id, hotspot.key)
    .run();

  return {
    distanceKm: distance,
    withinRadius: true,
    inserted: result.meta.changes,
  };
}

async function runAlertDryRun(request, env, url) {
  if (
    env.LOCAL_ALERT_DRY_RUN !== "true" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return new Response("Not found", { status: 404 });
  }

  if (!env.ALERTS_DB || !env.DEMO_ALERT_TOKEN) {
    return Response.json({ error: "Alert test is not configured." }, { status: 503 });
  }

  if (!hasDemoToken(request, env)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = env.ALERTS_DB;

  try {
    const subscription = await db.prepare(`
      SELECT id, latitude, longitude, radius_km
      FROM sms_subscriptions
      WHERE phone_e164 = ?
        AND latitude = ?
        AND longitude = ?
        AND radius_km = ?
        AND unsubscribed_at IS NULL
    `)
      .bind("+12025550142", 38.9, -77.04, 10)
      .first();

    if (!subscription) {
      return Response.json(
        { error: "The local 10 km test subscription was not found." },
        { status: 404 },
      );
    }

    const runId = `dry-run:${crypto.randomUUID()}`;
    const inside = {
      key: `${runId}:inside`,
      latitude: 38.95,
      longitude: -77.04,
    };
    const outside = {
      key: `${runId}:outside`,
      latitude: 39.1,
      longitude: -77.04,
    };

    const insideResult = await recordMatchingAlert(db, subscription, inside);
    const outsideResult = await recordMatchingAlert(db, subscription, outside);
    const replayResult = await recordMatchingAlert(db, subscription, inside);

    const { alert_count: alertRows } = await db.prepare(`
      SELECT COUNT(*) AS alert_count
      FROM sms_alerts
      WHERE subscription_id = ? AND detection_key IN (?, ?)
    `)
      .bind(subscription.id, inside.key, outside.key)
      .first();

    const passed =
      insideResult.withinRadius &&
      insideResult.inserted === 1 &&
      !outsideResult.withinRadius &&
      outsideResult.inserted === 0 &&
      replayResult.withinRadius &&
      replayResult.inserted === 0 &&
      alertRows === 1;

    return Response.json(
      {
        passed,
        radiusKm: subscription.radius_km,
        inside: insideResult,
        outside: outsideResult,
        replay: replayResult,
        alertRows,
        smsSent: false,
      },
      { status: passed ? 200 : 500 },
    );
  } catch {
    return Response.json(
      { error: "Could not complete the local alert test." },
      { status: 500 },
    );
  }
}

async function createSmsSubscription(request, env) {
  if (!env.ALERTS_DB || !env.DEMO_ALERT_TOKEN) {
    return Response.json(
      { error: "Subscriptions are not configured." },
      { status: 503 },
    );
  }

  if (!hasDemoToken(request, env)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const input = await request.json().catch(() => null);
  const { phone, latitude, longitude, radiusKm, consent } = input ?? {};

  if (
    consent !== true ||
    typeof phone !== "string" ||
    !/^\+[1-9][0-9]{1,14}$/.test(phone) ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(radiusKm) ||
    radiusKm <= 0
  ) {
    return Response.json(
      {
        error: "Provide a phone number in international format, valid coordinates, a positive radius, and explicit consent.",
      },
      { status: 400 },
    );
  }

  try {
    const db = env.ALERTS_DB;
    const nowMs = Date.now();
    const cutoff = new Date(nowMs - 60_000).toISOString();
    // Check the limit and insert in one statement so simultaneous requests share the cap.
    const created = await db.prepare(`
      INSERT INTO sms_subscriptions
        (phone_e164, latitude, longitude, radius_km, consented_at)
      SELECT ?, ?, ?, ?, ?
      WHERE (
        SELECT COUNT(*) FROM sms_subscriptions
        WHERE phone_e164 = ? AND consented_at > ?
      ) < 5
      ON CONFLICT (phone_e164, latitude, longitude, radius_km) DO NOTHING
      RETURNING id
    `).bind(phone, latitude, longitude, radiusKm, new Date(nowMs).toISOString(), phone, cutoff).first();

    if (!created) {
      const existing = await db.prepare(`
        SELECT id FROM sms_subscriptions
        WHERE phone_e164 = ? AND latitude = ? AND longitude = ? AND radius_km = ?
      `).bind(phone, latitude, longitude, radiusKm).first();
      if (existing) {
        return Response.json(
          { error: "A record already exists for this phone and area." },
          { status: 409 },
        );
      }

      return Response.json(
        { error: "Too many subscriptions for this phone number. Try again in a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    return Response.json({ created: true }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not save the subscription." },
      { status: 500 },
    );
  }
}

async function previewFirmsMatches(request, env, url) {
  if (
    env.LOCAL_ALERT_DRY_RUN !== "true" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return new Response("Not found", { status: 404 });
  }

  if (!env.ALERTS_DB || !env.DEMO_ALERT_TOKEN) {
    return Response.json({ error: "FIRMS preview is not configured." }, { status: 503 });
  }

  if (!hasDemoToken(request, env)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const subscription = await env.ALERTS_DB.prepare(`
    SELECT latitude, longitude, radius_km
    FROM sms_subscriptions
    WHERE phone_e164 = ?
      AND latitude = ?
      AND longitude = ?
      AND radius_km = ?
      AND unsubscribed_at IS NULL
  `)
    .bind("+12025550142", 38.9, -77.04, 10)
    .first();

  if (!subscription) {
    return Response.json(
      { error: "The local 10 km test subscription was not found." },
      { status: 404 },
    );
  }

  const csvUrl = new URL("/api/fires?satellite=NOAA20&days=3", url);
  const response = await getFires(csvUrl, env);
  if (!response.ok) {
    return response;
  }

  const csv = await response.text();
  const headers = csv.trim().split(/\r?\n/, 1)[0].split(",").map((value) => value.trim());
  if (!headers.includes("latitude") || !headers.includes("longitude")) {
    return Response.json({ error: "Unexpected NASA data format." }, { status: 502 });
  }

  // Evaluate the full CSV. The dashboard still uses its existing sample limit.
  const { detections } = parseMapDetections(csv, Infinity);
  let matchCount = 0;
  let nearestDistanceKm = null;

  for (const detection of detections) {
    const distance = distanceKm(
      subscription.latitude,
      subscription.longitude,
      detection.latitude,
      detection.longitude,
    );

    if (nearestDistanceKm === null || distance < nearestDistanceKm) {
      nearestDistanceKm = distance;
    }
    if (isWithinRadius(distance, subscription)) {
      matchCount += 1;
    }
  }

  // Center a temporary area on one real detection to verify a positive match.
  const sample = detections[0];
  const positiveControlMatched = sample
    ? isWithinRadius(
        distanceKm(sample.latitude, sample.longitude, sample.latitude, sample.longitude),
        subscription,
      )
    : null;

  return Response.json({
    satellite: "NOAA20",
    daysRequested: 3,
    detectionsChecked: detections.length,
    radiusKm: subscription.radius_km,
    matchCount,
    nearestDistanceKm,
    positiveControlMatched,
    alertRowsWritten: 0,
    smsSent: false,
  });
}

function parseMapDetections(csv, maxDetections = MAX_MAP_DETECTIONS) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { totalRows: 0, detections: [] };
  }

  const headers = lines[0]
    .replace(/^\uFEFF/, "")
    .split(",")
    .map((header) => header.trim());

  const latitudeIndex = headers.indexOf("latitude");
  const longitudeIndex = headers.indexOf("longitude");
  const dateIndex = headers.indexOf("acq_date");
  const timeIndex = headers.indexOf("acq_time");
  const confidenceIndex = headers.indexOf("confidence");
  const frpIndex = headers.indexOf("frp");

  if (latitudeIndex === -1 || longitudeIndex === -1) {
    return null;
  }

  const detections = [];
  const totalRows = lines.length - 1;
  const step = Math.max(1, Math.ceil(totalRows / maxDetections));

  for (let i = 1; i < lines.length; i += step) {
    const values = lines[i].split(",");
    const latitude = Number(values[latitudeIndex]);
    const longitude = Number(values[longitudeIndex]);

    if (
      values[latitudeIndex]?.trim() === "" ||
      values[longitudeIndex]?.trim() === "" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      continue;
    }

    const frpValue = frpIndex >= 0 ? values[frpIndex] : null;
    const frp =
      frpValue != null &&
      frpValue.trim() !== "" &&
      Number.isFinite(Number(frpValue))
        ? Number(frpValue)
        : null;

    detections.push({
      latitude,
      longitude,
      date: dateIndex >= 0 ? values[dateIndex] : null,
      time: timeIndex >= 0 ? values[timeIndex] : null,
      confidence: confidenceIndex >= 0 ? values[confidenceIndex] : null,
      frp,
    });
  }

  return { totalRows, detections };
}

async function getFires(url, env) {
  const rawCsv = url.pathname === "/api/fires";
  const satellite = url.searchParams.get("satellite") || "NOAA20";
  const days = Number(url.searchParams.get("days") || "1");

  if (!Object.hasOwn(SATELLITES, satellite)) {
    return Response.json({ error: "Invalid satellite selection" }, { status: 400 });
  }

  if (![1, 2, 3].includes(days)) {
    return Response.json({ error: "Days must be 1, 2, or 3" }, { status: 400 });
  }

  if (!env.FIRMS_MAP_KEY) {
    return Response.json(
      { error: "NASA FIRMS API key is not configured" },
      { status: 503 },
    );
  }

  const nasaUrl =
    `${FIRMS_CSV_BASE}${encodeURIComponent(env.FIRMS_MAP_KEY)}/` +
    `${SATELLITES[satellite]}/world/${days}`;

  try {
    const nasaResponse = await fetch(nasaUrl);

    if (!nasaResponse.ok) {
      return Response.json({ error: "NASA FIRMS request failed" }, { status: 502 });
    }

    if (rawCsv) {
      return new Response(nasaResponse.body, {
        headers: {
          ...MAP_HEADERS,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    const parsed = parseMapDetections(await nasaResponse.text());

    if (!parsed) {
      return Response.json({ error: "Unexpected NASA data format" }, { status: 502 });
    }

    const detections = parsed.detections.map((detection) => ({
      ...detection,
      satellite,
    }));

    return Response.json(
      {
        isDemo: false,
        satellite,
        days,
        returnedCount: detections.length,
        sampleOnly: parsed.totalRows > detections.length,
        detections,
      },
      { headers: MAP_HEADERS },
    );
  } catch {
    return Response.json(
      { error: rawCsv ? "Unable to reach NASA FIRMS" : "Unable to retrieve NASA map data" },
      { status: 502 },
    );
  }
}
async function sendTwilioSms(accountSid, authToken, from, to, body) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` },
      body: new URLSearchParams({ From: from, To: to, Body: body }),
    },
  );
  const result = await response.json().catch(() => null);
  return {
    messageSid: response.ok && typeof result?.sid === "string" ? result.sid : null,
    twilioStatus: result?.status ?? null,
    twilioCode: result?.code ?? null,
  };
}

function firmsDetectionKey(detection) {
  const date = detection.date?.trim();
  const time = detection.time?.trim().padStart(4, "0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(time ?? "")) {
    return null;
  }
  const timestamp = Date.parse(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return { timestamp, key: `firms:v1:NOAA20:${date}:${time}:${detection.latitude}:${detection.longitude}` };
}

async function claimFirmsSms(db, subscription, key) {
  // The migration's trigger reserves the phone cooldown in the same write.
  return db.prepare(`
    INSERT INTO sms_alerts (subscription_id, detection_key)
    SELECT subscription.id, ?
    FROM sms_subscriptions AS subscription
    WHERE subscription.id = ? AND subscription.phone_e164 = ?
      AND subscription.consented_at IS NOT NULL AND subscription.unsubscribed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM sms_send_cooldowns AS cooldown
        WHERE cooldown.phone_e164 = subscription.phone_e164
          AND cooldown.next_allowed_at_ms > unixepoch('now') * 1000
      )
      AND NOT EXISTS (
        SELECT 1
        FROM sms_alerts AS alert
        JOIN sms_subscriptions AS prior ON prior.id = alert.subscription_id
        WHERE prior.phone_e164 = subscription.phone_e164 AND alert.detection_key = ?
      )
    ON CONFLICT (subscription_id, detection_key) DO NOTHING
    RETURNING subscription_id
  `).bind(key, subscription.id, subscription.phone_e164, key).first();
}

async function sendScheduledFirmsAlerts(env, matches) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !/^\+[1-9][0-9]{1,14}$/.test(from ?? "")) {
    throw new Error("Scheduled SMS requires Twilio credentials and a sender number.");
  }

  let alertRowsWritten = 0;
  let twilioAccepted = 0;
  let failed = 0;
  const db = env.ALERTS_DB;
  for (const [phone, { subscription, key }] of matches) {
    if (!/^\+[1-9][0-9]{1,14}$/.test(phone) || phone === from) {
      continue;
    }
    if (!await claimFirmsSms(db, subscription, key)) {
      continue;
    }
    alertRowsWritten += 1;

    try {
      const result = await sendTwilioSms(
        accountSid, authToken, from, phone,
        "FireWatch: NASA FIRMS detected a possible hotspot near an area you follow. Check local official updates.",
      );
      if (!result.messageSid) {
        failed += 1;
        continue;
      }
      twilioAccepted += 1;
      await db.prepare(`
        UPDATE sms_alerts SET twilio_message_sid = ?
        WHERE subscription_id = ? AND detection_key = ?
      `).bind(result.messageSid, subscription.id, key).run();
    } catch {
      // Preserve the claim if Twilio may have accepted the request.
      failed += 1;
    }
  }
  return { alertRowsWritten, twilioAccepted, failed, smsSent: twilioAccepted > 0 };
}

async function runSmsDeliveryTest(request, env, url, detectionKey = "local-sms-delivery-test:v5", firmsDetection = null) {
  if (
    env.LOCAL_ALERT_DRY_RUN !== "true" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return new Response("Not found", { status: 404 });
  }

  if (!env.ALERTS_DB || !env.DEMO_ALERT_TOKEN) {
    return Response.json({ error: "The local SMS test is not configured." }, { status: 503 });
  }

  if (!hasDemoToken(request, env)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const input = await request.json().catch(() => null);
  if (input?.confirmTestSms !== true) {
    return Response.json({ error: "Confirm the test SMS explicitly." }, { status: 400 });
  }

  const {
    ALERTS_DB: db,
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_FROM_NUMBER: from,
    TWILIO_TEST_TO_NUMBER: to,
  } = env;
  console.log("ACTUAL WORKER RECIPIENT:", String(to).slice(-4));

  const phonePattern = /^\+[1-9][0-9]{1,14}$/;
  if (
    !accountSid ||
    !authToken ||
    !phonePattern.test(from ?? "") ||
    !phonePattern.test(to ?? "") ||
    from === to
  ) {
    return Response.json({ error: "Check the local Twilio settings." }, { status: 503 });
  }

  const hotspot = {
    key: detectionKey,
    latitude: firmsDetection?.latitude ?? 38.95,
    longitude: firmsDetection?.longitude ?? -77.04,
  };

  const centerLatitude = firmsDetection
    ? firmsDetection.latitude + (firmsDetection.latitude > 0 ? -0.05 : 0.05)
    : 38.9;
  const centerLongitude = firmsDetection?.longitude ?? -77.04;

  let subscription;
  try {
    // Use only the configured Dev Phone recipient and the fixed test area.
    await db.prepare(`
      INSERT INTO sms_subscriptions
        (phone_e164, latitude, longitude, radius_km, consented_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (phone_e164, latitude, longitude, radius_km) DO NOTHING
    `).bind(to, centerLatitude, centerLongitude, 10, new Date().toISOString()).run();

    subscription = await db.prepare(`
      SELECT id, latitude, longitude, radius_km
      FROM sms_subscriptions
      WHERE phone_e164 = ? AND latitude = ? AND longitude = ? AND radius_km = ?
        AND unsubscribed_at IS NULL
    `).bind(to, centerLatitude, centerLongitude, 10).first();

    if (!subscription) {
      return Response.json({ error: "The test subscription is inactive." }, { status: 409 });
    }

    const match = await recordMatchingAlert(db, subscription, hotspot);
    if (!match.withinRadius) {
      return Response.json({ error: "The test detection did not match." }, { status: 500 });
    }

    if (match.inserted === 0) {
      const existing = await db.prepare(`
        SELECT twilio_message_sid
        FROM sms_alerts
        WHERE subscription_id = ? AND detection_key = ?
      `).bind(subscription.id, hotspot.key).first();

      return Response.json({
        outcome: "duplicate_skipped",
        twilioCalled: false,
        messageSid: existing?.twilio_message_sid ?? null,
      });
    }
  } catch {
    return Response.json({ error: "The local D1 check failed before sending." }, { status: 500 });
  }

  let messageSid;
  let twilioStatus;
  try {
    const result = await sendTwilioSms(
      accountSid, authToken, from, to,
      firmsDetection
        ? "FireWatch TEST: NASA FIRMS hotspot matched a test area. No action needed."
        : "FireWatch TEST: Simulated hotspot alert. No action needed.",
    );

    if (!result.messageSid) {
      return Response.json({
        outcome: "twilio_acceptance_unconfirmed",
        twilioCode: result.twilioCode,
        replayBlocked: true,
      }, { status: 502 });
    }

    messageSid = result.messageSid;
    twilioStatus = result.twilioStatus;
  } catch {
    return Response.json({
      outcome: "twilio_acceptance_unconfirmed",
      replayBlocked: true,
    }, { status: 502 });
  }

  try {
    await db.prepare(`
      UPDATE sms_alerts
      SET twilio_message_sid = ?
      WHERE subscription_id = ? AND detection_key = ?
    `).bind(messageSid, subscription.id, hotspot.key).run();
  } catch {
    return Response.json({
      outcome: "twilio_accepted_sid_not_saved",
      messageSid,
      twilioStatus,
      replayBlocked: true,
    }, { status: 500 });
  }

  return Response.json({
    outcome: "twilio_accepted",
    messageSid,
    twilioStatus,
  }, { status: 202 });
}

export default {
  async scheduled(controller, env) {
    if (
      env.LOCAL_ALERT_DRY_RUN === "true" &&
      (env.LOCAL_SCHEDULED_SMS_TEST === "true" ||
        env.LOCAL_SCHEDULED_FIRMS_SMS_TEST === "true")
    ) {
      if (!env.DEMO_ALERT_TOKEN) {
        throw new Error("Scheduled SMS test requires DEMO_ALERT_TOKEN.");
      }

      const firmsDetection = env.LOCAL_SCHEDULED_FIRMS_SMS_TEST === "true" ? {"satellite":"NOAA20","date":"2026-11-13","time":"0015","latitude":19.4086,"longitude":-155.27255} : null;
      const url = new URL("http://localhost/api/local/sms-delivery-test");
      const request = new Request(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DEMO_ALERT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmTestSms: true }),
      });

      const response = await runSmsDeliveryTest(
        request,
        env,
        url,
        firmsDetection ? `local-firms-sms-test:${JSON.stringify(firmsDetection)}` : "local-scheduled-sms-test:v1",
        firmsDetection,
      );
      const result = await response.json();
      console.log("FireWatch scheduled SMS test", JSON.stringify(result));

      if (!response.ok) {
        throw new Error(`Scheduled SMS test failed with HTTP ${response.status}.`);
      }
      return;
    }
    const dryRun = env.LOCAL_ALERT_DRY_RUN === "true";
    const liveSms = !dryRun && env.SCHEDULED_SMS_ENABLED === "true";
    if (!dryRun && !liveSms) {
      console.log("FireWatch scheduled processing is disabled.");
      return;
    }

    if (!env.ALERTS_DB || !env.FIRMS_MAP_KEY) {
      throw new Error("Scheduled processing requires ALERTS_DB and FIRMS_MAP_KEY.");
    }

    const { results: subscriptions } = await env.ALERTS_DB.prepare(`
      SELECT id, phone_e164, latitude, longitude, radius_km
      FROM sms_subscriptions
      WHERE consented_at IS NOT NULL AND unsubscribed_at IS NULL
    `).all();

    const url = new URL("http://localhost/api/fires?satellite=NOAA20&days=3");
    const response = await getFires(url, env);
    if (!response.ok) {
      throw new Error(`FIRMS request failed with HTTP ${response.status}.`);
    }

    const csv = await response.text();
    const headers = csv.trim().split(/\r?\n/, 1)[0].split(",").map((value) => value.trim());
    if (!headers.includes("latitude") || !headers.includes("longitude")) {
      throw new Error("FIRMS returned an unexpected CSV format.");
    }

    const { detections } = parseMapDetections(csv, Infinity);
    const latestByPhone = new Map();
    const candidates = liveSms ? detections.map(firmsDetectionKey) : [];
    let matchedSubscriptions = 0;
    let matchingPairs = 0;

    for (const subscription of subscriptions) {
      let matches = 0;

      for (const [index, detection] of detections.entries()) {
        const candidate = candidates[index];
        const distance = distanceKm(
          subscription.latitude,
          subscription.longitude,
          detection.latitude,
          detection.longitude,
        );
        if (isWithinRadius(distance, subscription)) {
          matches += 1;
          if (candidate) {
            const previous = latestByPhone.get(subscription.phone_e164);
            if (!previous || candidate.timestamp > previous.timestamp ||
                (candidate.timestamp === previous.timestamp && candidate.key < previous.key)) {
              latestByPhone.set(subscription.phone_e164, { ...candidate, subscription });
            }
          }
        }
      }

      if (matches > 0) {
        matchedSubscriptions += 1;
        matchingPairs += matches;
      }
    }

    const delivery = liveSms
      ? await sendScheduledFirmsAlerts(env, latestByPhone)
      : { alertRowsWritten: 0, smsSent: false };
    console.log(dryRun ? "FireWatch scheduled dry run" : "FireWatch scheduled SMS", JSON.stringify({
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      satellite: "NOAA20",
      daysRequested: 3,
      activeSubscriptions: subscriptions.length,
      detectionsChecked: detections.length,
      matchedSubscriptions,
      matchingPairs,
      ...delivery,
    }));
  },


  
  async fetch(request, env) {
    const url = new URL(request.url);

    // TEMPORARY LOCAL DEBUGGING: Does not send any SMS.
    if (
      request.method === "GET" &&
      url.pathname === "/api/local/check-recipient" &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      env.LOCAL_ALERT_DRY_RUN === "true"
    ) {
      return Response.json({
        configured: Boolean(env.TWILIO_TEST_TO_NUMBER),
        recipientLast4: String(env.TWILIO_TEST_TO_NUMBER ?? "").slice(-4),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/sms-subscriptions") {
      return createSmsSubscription(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/local/alert-dry-run") {
      return runAlertDryRun(request, env, url);
    }

    if (request.method === "POST" && url.pathname === "/api/local/firms-match-preview") {
      return previewFirmsMatches(request, env, url);
    }

    if (request.method === "POST" && url.pathname === "/api/local/sms-delivery-test") {
      return runSmsDeliveryTest(request, env, url);
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/calendar") {
      return Response.json({
        isDemo: true,
        months: [
          {
            month: "2024-08",
            activityCount: 42,
            historicalMedian: 30,
            coverageStatus: "complete",
          },
        ],
      });
    }

    if (url.pathname === "/api/fires" || url.pathname === "/api/fire-map") {
      return getFires(url, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
