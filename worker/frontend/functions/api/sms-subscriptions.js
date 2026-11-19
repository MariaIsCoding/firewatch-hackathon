
export async function onRequestPost({ request, env }) {
  // Only accept requests from the FireWatch website.
  const origin = request.headers.get('Origin')

  if (origin !== new URL(request.url).origin) {
    return Response.json(
      { error: 'Submit the form from the FireWatch site.' },
      { status: 403 }
    )
  }

  // Connect to the Cloudflare D1 database.
  const db = env.ALERTS_DB

  if (!db) {
    console.error('Missing ALERTS_DB binding')

    return Response.json(
      { error: 'The subscription service is temporarily unavailable.' },
      { status: 503 }
    )
  }

  // Read the SMS subscription form.
  const input = await request.json().catch(() => null)
  const { phone, latitude, longitude, radiusKm, consent } = input ?? {}

  // Validate phone number, location, monitoring radius, and consent.
  if (
    typeof phone !== 'string' ||
    !/^\+[1-9][0-9]{1,14}$/.test(phone) ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    ![5, 10, 25, 50].includes(radiusKm) ||
    consent !== true
  ) {
    return Response.json(
      {
        error:
          'Provide a valid phone number, monitoring area, radius, and consent.'
      },
      { status: 400 }
    )
  }

  try {
    const now = Date.now()
    const timestamp = new Date(now).toISOString()
    const cutoff = new Date(now - 60_000).toISOString()

    // Check whether this subscription already exists.
    const existing = await db.prepare(`
      SELECT id
      FROM sms_subscriptions
      WHERE phone_e164 = ?
        AND latitude = ?
        AND longitude = ?
        AND radius_km = ?
    `).bind(
      phone,
      latitude,
      longitude,
      radiusKm
    ).first()

    if (existing) {
      return Response.json(
        {
          error: 'This phone number and area are already registered.'
        },
        { status: 409 }
      )
    }

    // Limit new subscriptions per phone number.
    const recent = await db.prepare(`
      SELECT COUNT(*) AS total
      FROM sms_subscriptions
      WHERE phone_e164 = ?
        AND consented_at > ?
    `).bind(phone, cutoff).first()

    if (Number(recent?.total ?? 0) >= 5) {
      return Response.json(
        {
          error: 'Too many signups. Try again in a minute.'
        },
        {
          status: 429,
          headers: { 'Retry-After': '60' }
        }
      )
    }

    // Save the subscription to Cloudflare D1.
    await db.prepare(`
      INSERT INTO sms_subscriptions
        (phone_e164, latitude, longitude, radius_km, consented_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      phone,
      latitude,
      longitude,
      radiusKm,
      timestamp
    ).run()

    // Confirm successful registration.
    return Response.json(
      { created: true },
      { status: 201 }
    )

  } catch (error) {
    // Log errors privately without exposing database details.
    console.error('D1 subscription error:', error)

    return Response.json(
      {
        error:
          'Unable to save your subscription. Please try again later.'
      },
      { status: 500 }
    )
  }
}
