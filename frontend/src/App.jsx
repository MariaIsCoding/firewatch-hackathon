
import { useEffect, useState } from 'react'
import HistoricalChart from './HistoricalChart'
import FireCalendar from './FireCalendar'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const satelliteLabels = {
  ALL: 'All available satellites',
  MODIS: 'MODIS — Terra & Aqua',
  NOAA20: 'VIIRS — NOAA-20',
  NOAA21: 'VIIRS — NOAA-21',
}

const satelliteOptions = ['ALL', 'MODIS', 'NOAA20', 'NOAA21']

const API_BASE = 'http://localhost:8787'

function App() {
  const [selectedSatellite, setSelectedSatellite] = useState('NOAA20')
  const [selectedPeriod, setSelectedPeriod] = useState(1)

  const [liveHotspots, setLiveHotspots] = useState([])
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState('')
  const [mapSampleOnly, setMapSampleOnly] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function loadFireData() {
      setMapLoading(true)
      setMapError('')
      setLiveHotspots([])
      setMapSampleOnly(false)

      try {
        const satellites =
          selectedSatellite === 'ALL'
            ? ['MODIS', 'NOAA20', 'NOAA21']
            : [selectedSatellite]

        const responses = await Promise.all(
          satellites.map(async (satellite) => {
            const url =
              `${API_BASE}/api/fire-map?` +
              `satellite=${satellite}&days=${selectedPeriod}`

            const response = await fetch(url, {
              signal: controller.signal
            })

            if (!response.ok) {
              throw new Error(
                `Unable to load ${satelliteLabels[satellite]} data (${response.status})`
              )
            }

            const data = await response.json()

            if (!Array.isArray(data.detections)) {
              throw new Error(
                `Unexpected response from ${satelliteLabels[satellite]}`
              )
            }

            if (data.isDemo === true) {
              throw new Error(
                `${satelliteLabels[satellite]} returned demonstration data`
              )
            }

            return {
              satellite,
              detections: data.detections,
              sampleOnly: data.sampleOnly === true
            }
          })
        )

        if (controller.signal.aborted) return

        const combined = responses.flatMap((result) =>
          result.detections.map((spot) => ({
            ...spot,
            satellite: result.satellite
          }))
        )

        setLiveHotspots(combined)
        setMapSampleOnly(
          responses.some((result) => result.sampleOnly)
        )
      } catch (error) {
        if (controller.signal.aborted) return

        setMapError(error.message)
        setLiveHotspots([])
      } finally {
        if (!controller.signal.aborted) {
          setMapLoading(false)
        }
      }
    }

    loadFireData()

    return () => controller.abort()
  }, [selectedSatellite, selectedPeriod])

  return (
    <main>
      <header>
        <h1>🔥 FireWatch</h1>
        <p>NASA Satellite Fire Activity Dashboard</p>
      </header>

      <section>
        <h2>Welcome to FireWatch</h2>
        <p>
          Explore satellite hotspot detections and historical
          fire activity from NASA FIRMS.
        </p>
      </section>

      <section>
        <div className="map-heading">
          <h2>🌍 Fire Detection Map</h2>
          <span className="map-demo-badge">
            NASA FIRMS DATA
          </span>
        </div>

        <p className="map-description">
          Explore recent satellite-detected thermal hotspots
          around the world. Click a marker to view its
          observation details.
        </p>

        <div className="map-filter-panel">
          <h3>Satellite Observations</h3>

          <div className="map-filter-options">
            {satelliteOptions.map((value) => (
              <label key={value} className="map-filter-option">
                <input
                  type="radio"
                  name="mapSatellite"
                  value={value}
                  checked={selectedSatellite === value}
                  onChange={() => setSelectedSatellite(value)}
                />
                <span>{satelliteLabels[value]}</span>
              </label>
            ))}
          </div>

          <p className="map-filter-status">
            Selected:{' '}
            <strong>
              {satelliteLabels[selectedSatellite]}
            </strong>
          </p>
        </div>

        <div className="map-time-panel">
          <h3>🕒 Recent Satellite Observations</h3>

          <p className="map-time-description">
            Choose how many recent days of NASA FIRMS
            observations to request.
          </p>

          <div className="map-time-options">
            {[1, 2, 3].map((days) => (
              <button
                key={days}
                type="button"
                className={
                  selectedPeriod === days
                    ? 'map-time-button active'
                    : 'map-time-button'
                }
                onClick={() => setSelectedPeriod(days)}
              >
                {days === 1
                  ? '1 day'
                  : `${days} days`}
              </button>
            ))}
          </div>

          <p className="map-time-status">
            Selected:{' '}
            <strong>
              {selectedPeriod} {selectedPeriod === 1 ? 'day' : 'days'}
            </strong>
          </p>
        </div>

        {mapLoading && (
          <p>🛰️ Loading NASA satellite detections...</p>
        )}

        {mapError && (
          <p style={{ color: '#fca5a5' }}>
            ⚠️ {mapError}
          </p>
        )}

        {!mapLoading && !mapError && (
          <p>
            🔥 Displaying{' '}
            {liveHotspots.length.toLocaleString()}{' '}
            NASA satellite hotspot detections
            {mapSampleOnly ? ' (limited sample)' : ''}.
          </p>
        )}

        <MapContainer
          center={[15, 0]}
          zoom={2}
          scrollWheelZoom={true}
          style={{
            height: '450px',
            width: '100%',
            borderRadius: '12px'
          }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {liveHotspots
            .filter((spot) =>
              Number.isFinite(Number(spot.latitude)) &&
              Number.isFinite(Number(spot.longitude)) &&
              Number(spot.latitude) >= -90 &&
              Number(spot.latitude) <= 90 &&
              Number(spot.longitude) >= -180 &&
              Number(spot.longitude) <= 180
            )
            .map((spot, index) => (
              <ReactFragmentMarker
                key={`${spot.satellite}-${index}`}
                spot={spot}
              />
            ))}
        </MapContainer>

        <div className="map-legend">
          <div className="map-legend-item">
            <span className="map-legend-dot"></span>
            <span>
              Orange markers — NASA satellite hotspot detections
            </span>
          </div>

          <p>
            {mapSampleOnly
              ? 'This map displays a limited sample of detections, not every hotspot worldwide.'
              : 'Each marker represents a satellite observation, not necessarily a separate wildfire.'}
          </p>
        </div>

        <div className="map-satellite-info">
          <h3>🛰️ Why Are Different Satellites Used?</h3>

          <p>
            FireWatch uses historical MODIS and VIIRS Suomi NPP
            observations to explore past fire activity
            from 2015–2026.
          </p>

          <p>
            The recent detection map uses MODIS (Terra and Aqua),
            VIIRS NOAA-20, and VIIRS NOAA-21 observations.
            Different satellites can observe the same area
            at different times.
          </p>

          <p className="map-satellite-disclaimer">
            Satellite hotspots are not necessarily individual
            wildfires. The same fire may be detected multiple
            times or by different satellites.
          </p>
        </div>
      </section>

      <section>
        <h2>📊 Historical Fire Activity</h2>
        <p>
          Explore NASA satellite fire detections from 2015–2026.
        </p>
        <HistoricalChart />
      </section>

      <section className="card">
        <FireCalendar />
      </section>
    </main>
  )
}

// Two circles share the same location:
// a larger invisible clickable area and a smaller orange dot.
function ReactFragmentMarker({ spot }) {
  const position = [
    Number(spot.latitude),
    Number(spot.longitude)
  ]

  return (
    <>
      {/* Invisible clickable area */}
      <CircleMarker
        center={position}
        radius={12}
        pathOptions={{
          stroke: false,
          fillColor: '#f97316',
          fillOpacity: 0.001
        }}
      >
        <Popup>
          <strong>
            NASA FIRMS — {satelliteLabels[spot.satellite]}
          </strong>

          <p>
            Observation date: {spot.date || 'Unavailable'}
          </p>

          <p>
            Latitude: {spot.latitude}
            <br />
            Longitude: {spot.longitude}
          </p>

          <p>
            Fire Radiative Power:{' '}
            {spot.frp ?? 'N/A'} MW
          </p>

          <p>
            Satellite hotspot detection — not
            necessarily an individual wildfire.
          </p>
        </Popup>
      </CircleMarker>

      {/* Visible orange dot */}
      <CircleMarker
        center={position}
        radius={6}
        interactive={false}
        pathOptions={{
          color: '#fb923c',
          fillColor: '#f97316',
          fillOpacity: 0.75,
          weight: 1
        }}
      />
    </>
  )
}

export default App
