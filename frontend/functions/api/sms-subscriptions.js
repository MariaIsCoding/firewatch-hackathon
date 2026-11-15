
export async function onRequestPost({ request, env }) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return Response.json(
      { error: 'Submit the form from the FireWatch site.' },
      { status: 403 }
    )
  }

  const db = env.ALERTS_DB

  if (!db) {
    return Response.json(
      { error: 'Subscription database is not configured.' },
      { status: 503 }
    )
  }

  const input = await request.json().catch(() => null)
  const { phone, latitude, longitude, radiusKm, consent } = input ?? {}

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
      { error: 'Provide a valid phone, area, radius, and consent.' },
      { status: 400 }
    )
  }

  try {
    const existing = await db.prepare(`
      SELECT id FROM sms_subscriptions
      WHERE phone_e164 = ?
        AND latitude = ?
        AND longitude = ?
        AND radius_km = ?
    `).bind(phone, latitude, longitude, radiusKm).first()

    if (existing) {
      return Response.json(
        { error: 'This monitoring area is already registered.' },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()

    await db.prepare(`
      INSERT INTO sms_subscriptions
        (phone_e164, latitude, longitude, radius_km, consented_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(phone, latitude, longitude, radiusKm, now).run()

    return Response.json({ created: true }, { status: 201 })
  } catch {
    return Response.json(
      { error: 'Could not save the subscription.' },
      { status: 500 }
    )
  }
}
