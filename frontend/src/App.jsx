
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

// Temporary demonstration data — NOT real NASA detections
const demoHotspots = [
  { id: 1, lat: 34.05, lon: -118.24, name: 'California' },
  { id: 2, lat: -3.1, lon: -60.0, name: 'Brazil' },
  { id: 3, lat: -25.7, lon: 28.2, name: 'South Africa' },
]

function App() {
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
        <h2>🌍 Live Fire Detection Map</h2>
        <p>
          Interactive world map. Demonstration markers are shown
          until the NASA live data connection is ready.
        </p>

        <MapContainer
          center={[15, 0]}
          zoom={2}
          scrollWheelZoom={true}
          style={{ height: '450px', width: '100%', borderRadius: '12px' }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {demoHotspots.map((spot) => (
            <CircleMarker
              key={spot.id}
              center={[spot.lat, spot.lon]}
              radius={8}
              pathOptions={{
                color: '#fb923c',
                fillColor: '#f97316',
                fillOpacity: 0.85,
              }}
            >
              <Popup>
                <strong>{spot.name}</strong>
                <p>Demonstration marker — not a verified fire detection.</p>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </section>

      <section>
        <h2>📊 Historical Fire Activity</h2>
        <p>MODIS and VIIRS historical data (2015–2026).</p>
        <p>Historical charts coming soon.</p>
      </section>

      <section>
        <h2>📅 Fire Activity Calendar</h2>
        <p>Explore satellite detections by date.</p>
      </section>
    </main>
  )
}

export default App
