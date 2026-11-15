
import { useState } from 'react'

export default function AlertSignup({ area }) {
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  async function save(event) {
    event.preventDefault()
    if (!area || saving) return

    const form = event.currentTarget
    const fields = new FormData(form)
    const phone = String(fields.get('phone') ?? '').trim()
    const latitude = Number(area.latitude)
    const longitude = Number(area.longitude)
    const radiusKm = Number(fields.get('radiusKm'))

    if (!/^\+[1-9][0-9]{1,14}$/.test(phone)) {
      setResult({
        error: 'Enter your phone number with a country code, such as +1.'
      })
      return
    }

    if (
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180
    ) {
      setResult({ error: 'Select a valid location on the map.' })
      return
    }

    setSaving(true)
    setResult(null)

    try {
      const response = await fetch('/api/sms-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          latitude,
          longitude,
          radiusKm,
          consent: fields.get('consent') === 'on'
        })
      })

      const data = await response.json()

      if (!response.ok || data.created !== true) {
        throw new Error(data.error || 'Unable to save subscription.')
      }

      form.reset()
      setResult({
        message:
          '✓ FireWatch subscription saved! Your monitoring location and alert radius have been recorded. SMS delivery is currently disabled pending Twilio messaging registration.'
      })
    } catch (error) {
      setResult({
        error: error instanceof SyntaxError
          ? 'The signup service is unavailable.'
          : error.message
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} style={{
      display: 'grid',
      gap: '0.75rem',
      maxWidth: '30rem'
    }}>
      <p aria-live="polite">
        {area &&
        Number.isFinite(Number(area.latitude)) &&
        Number.isFinite(Number(area.longitude))
          ? `Monitoring center: ${Number(area.latitude).toFixed(4)}, ${Number(area.longitude).toFixed(4)}`
          : 'Choose a monitoring center on the map first.'}
      </p>

      <label>
        Monitoring radius{' '}
        <select name="radiusKm" defaultValue="10" disabled={saving}>
          {[5, 10, 25, 50].map(km => (
            <option key={km} value={km}>{km} km</option>
          ))}
        </select>
      </label>

      <label>
        Phone number{' '}
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+12025550143"
          required
          disabled={saving}
        />
      </label>

      <label>
        <input
          name="consent"
          type="checkbox"
          required
          disabled={saving}
        />{' '}
        I consent to receive FireWatch hotspot notifications
        for this monitoring area if SMS alerts are enabled.
      </label>

      <button
        className="map-time-button"
        type="submit"
        disabled={!area || saving}
      >
        {saving ? 'Saving…' : 'Save demo subscription'}
      </button>

      {result?.error && <p role="alert">{result.error}</p>}
      {result?.message && <p role="status">{result.message}</p>}
    </form>
  )
}
