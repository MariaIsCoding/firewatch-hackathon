import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Rectangle,
  useMap,
  useMapEvents
} from 'react-leaflet'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import HistoricalChart from './HistoricalChart'
import FireCalendar from './FireCalendar'
import './App.css'

// ==================================================
// SETTINGS
// ==================================================

const API_BASE = 'http://localhost:8787'
const REFRESH_MS = 15 * 60 * 1000
const VIEWPORT_DELAY_MS = 450
const DETAIL_ZOOM = 5
const TILE_DEGREES = 10
const MAX_VISIBLE_TILES = 24
const MAX_CONCURRENT_REQUESTS = 3

const satelliteLabels = {
  ALL: 'All available satellites',
  MODIS: 'MODIS — Terra & Aqua',
  NOAA20: 'VIIRS — NOAA-20',
  NOAA21: 'VIIRS — NOAA-21'
}

const periodOptions = [
  { value: 'live', label: '🟢 Near Live' },
  { value: '24', label: 'Last 24 Hours' },
  { value: '48', label: 'Last 48 Hours' },
  { value: '72', label: 'Last 72 Hours' }
]

function periodLabel(value) {
  return value === 'live'
    ? 'Near Live (current UTC day)'
    : `Last ${value} hours`
}

function formatTime(value, utc = false) {
  if (!value) return 'Not available yet'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Not available yet'
  }

  return utc
    ? date.toLocaleString('en-US', {
        timeZone: 'UTC',
        timeZoneName: 'short'
      })
    : date.toLocaleString()
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

function getSatellites(value) {
  return value === 'ALL'
    ? ['MODIS', 'NOAA20', 'NOAA21']
    : [value]
}

function getTimeParams(value) {
  return {
    mode: value === 'live' ? 'live' : 'rolling',
    days:
      value === 'live'
        ? '1'
        : String(Number(value) / 24)
  }
}

function getViewport(map) {
  const bounds = map.getBounds()

  return {
    zoom: map.getZoom(),
    west: bounds.getWest(),
    east: bounds.getEast(),
    south: bounds.getSouth(),
    north: bounds.getNorth()
  }
}

function getVisibleTiles(viewport) {
  if (!viewport) return []

  const west = Math.max(-180, viewport.west)
  const east = Math.min(180, viewport.east)
  const south = Math.max(-90, viewport.south)
  const north = Math.min(90, viewport.north)

  if (west >= east || south >= north) return []

  const minX = Math.max(
    0,
    Math.floor((west + 180) / TILE_DEGREES)
  )
  const maxX = Math.min(
    35,
    Math.ceil((east + 180) / TILE_DEGREES) - 1
  )
  const minY = Math.max(
    0,
    Math.floor((south + 90) / TILE_DEGREES)
  )
  const maxY = Math.min(
    17,
    Math.ceil((north + 90) / TILE_DEGREES) - 1
  )

  const tiles = []

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      tiles.push({ x, y, id: `${x}-${y}` })
    }
  }

  return tiles
}

const searchLocationIcon = L.divIcon({
  className: 'firewatch-search-marker',
  html: `
    <div style="
      width:16px;
      height:16px;
      background:#2563eb;
      border:3px solid white;
      border-radius:50%;
      box-shadow:0 0 0 3px #2563eb55;
    "></div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11]
})

// ==================================================
// MAP HELPERS
// ==================================================

function MapFlyTo({ target }) {
  const map = useMap()

  useEffect(() => {
    if (!target) return

    map.flyTo(
      [target.latitude, target.longitude],
      target.zoom,
      { duration: 1.5 }
    )
  }, [map, target])

  return null
}

function MapViewportTracker({ onViewportChange }) {
  const map = useMapEvents({
    moveend: () => onViewportChange(getViewport(map)),
    zoomend: () => onViewportChange(getViewport(map))
  })

  useEffect(() => {
    onViewportChange(getViewport(map))
  }, [map, onViewportChange])

  return null
}

function popupOptions(maxWidth = 280) {
  return {
    maxWidth,
    maxHeight: 260,
    autoPan: true,
    autoPanPaddingTopLeft: [25, 40],
    autoPanPaddingBottomRight: [25, 40],
    keepInView: false,
    autoClose: true,
    closeOnClick: true,
    closeButton: true
  }
}

function addPopupLine(container, text) {
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  container.appendChild(paragraph)
}

function summaryRadius(count) {
  return Math.min(
    25,
    Math.max(6, 5 + Math.sqrt(count) * 0.35)
  )
}

// ==================================================
// WORLDWIDE SUMMARY LAYER
// ==================================================

function SummaryLayer({ cells, onSelect }) {
  const map = useMap()

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.5 })
    const layer = L.layerGroup()

    for (const cell of cells) {
      const latitude = Number(cell.latitude)
      const longitude = Number(cell.longitude)
      const count = Number(cell.count) || 0

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        continue
      }

      const circle = L.circleMarker(
        [latitude, longitude],
        {
          renderer,
          radius: summaryRadius(count),
          color: '#fdba74',
          fillColor: '#f97316',
          fillOpacity: 0.65,
          weight: 1.5,
          interactive: true
        }
      )

      circle.on('click', () => {
        onSelect({
          ...cell,
          type: 'summary'
        })

        const content = document.createElement('div')
        content.style.minWidth = '190px'

        const heading = document.createElement('strong')
        heading.textContent = '🔥 Geographic Fire Activity'
        content.appendChild(heading)

        addPopupLine(
          content,
          `${formatNumber(count)} observations`
        )

        addPopupLine(
          content,
          'This circle summarizes satellite observations in a geographic area, not individual wildfires.'
        )

        addPopupLine(
          content,
          `Latitude: ${cell.south}° to ${cell.north}°`
        )

        addPopupLine(
          content,
          `Longitude: ${cell.west}° to ${cell.east}°`
        )

        addPopupLine(
          content,
          `Highest FRP: ${
            cell.highestFRP != null
              ? `${Number(cell.highestFRP).toFixed(2)} MW`
              : 'N/A'
          }`
        )

        addPopupLine(
          content,
          'Zoom in to explore individual satellite detections.'
        )

        circle
          .bindPopup(content, popupOptions(300))
          .openPopup()
      })

      layer.addLayer(circle)
    }

    layer.addTo(map)

    return () => {
      layer.remove()
      renderer.remove()
    }
  }, [map, cells, onSelect])

  return null
}

// ==================================================
// INDIVIDUAL HOTSPOT LAYER
// ==================================================

function DetailLayer({ detections, onSelect, selectedArea }) {
  const map = useMap()

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.5 })
    const layer = L.layerGroup()

    let cancelled = false
    let frame = null
    let index = 0

    function addBatch() {
      if (cancelled) return

      const end = Math.min(
        index + 250,
        detections.length
      )

      for (; index < end; index++) {
        const spot = detections[index]

        const latitude = Number(spot.latitude)
        const longitude = Number(spot.longitude)

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          continue
        }

        const inSelectedArea =
          selectedArea &&
          spot.satellite === selectedArea.satellite &&
          latitude >= selectedArea.south &&
          latitude < selectedArea.north &&
          longitude >= selectedArea.west &&
          longitude < selectedArea.east

        const circle = L.circleMarker(
          [latitude, longitude],
          {
            renderer,
            radius: inSelectedArea ? 7 : 6,
            color: inSelectedArea ? '#fef08a' : '#fb923c',
            fillColor: '#f97316',
            fillOpacity: inSelectedArea ? 0.95 : 0.75,
            weight: inSelectedArea ? 2.5 : 1,
            interactive: true
          }
        )

        circle.on('click', () => {
          onSelect({
            ...spot,
            type: 'hotspot'
          })

          const content = document.createElement('div')
          content.style.minWidth = '190px'

          const heading = document.createElement('strong')
          heading.textContent =
            'NASA FIRMS — ' +
            (satelliteLabels[spot.satellite] ||
              spot.satellite)

          content.appendChild(heading)

          addPopupLine(
            content,
            `Observation (local): ${formatTime(
              spot.observedAt
            )}`
          )

          addPopupLine(
            content,
            `Observation (UTC): ${formatTime(
              spot.observedAt,
              true
            )}`
          )

          addPopupLine(
            content,
            `Latitude: ${spot.latitude}`
          )

          addPopupLine(
            content,
            `Longitude: ${spot.longitude}`
          )

          addPopupLine(
            content,
            `Fire Radiative Power: ${
              spot.frp ?? 'N/A'
            } MW`
          )

          addPopupLine(
            content,
            `Confidence: ${spot.confidence ?? 'N/A'}`
          )

          addPopupLine(
            content,
            'Satellite hotspot detection — not necessarily an individual wildfire.'
          )

          circle
            .bindPopup(content, popupOptions())
            .openPopup()
        })

        layer.addLayer(circle)
      }

      if (index < detections.length) {
        frame = requestAnimationFrame(addBatch)
      }
    }

    layer.addTo(map)
    frame = requestAnimationFrame(addBatch)

    return () => {
      cancelled = true

      if (frame !== null) {
        cancelAnimationFrame(frame)
      }

      layer.remove()
      renderer.remove()
    }
  }, [map, detections, onSelect, selectedArea])

  return null
}

// ==================================================
// REQUEST CONCURRENCY
// ==================================================

async function fetchWithConcurrency(
  tasks,
  limit,
  signal
) {
  const results = new Array(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      if (signal.aborted) {
        throw new DOMException(
          'Request cancelled',
          'AbortError'
        )
      }

      const index = nextIndex++
      results[index] = await tasks[index]()
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, tasks.length) },
      () => worker()
    )
  )

  return results
}

// ==================================================
// INFORMATION PANEL
// ==================================================

function ObservationField({ label, children }) {
  return (
    <div>
      <p
        style={{
          color: '#94a3b8',
          marginBottom: '6px',
          fontSize: '13px'
        }}
      >
        {label}
      </p>

      <strong style={{ overflowWrap: 'anywhere' }}>
        {children}
      </strong>
    </div>
  )
}

function ObservationPanel({
  observation,
  onClose,
  onExplore
}) {
  if (!observation) return null

  const isSummary = observation.type === 'summary'

  return (
    <div
      role="region"
      aria-label="Selected satellite observation details"
      style={{
        marginTop: '16px',
        marginBottom: '20px',
        padding: '22px',
        backgroundColor: '#1e293b',
        border: '1px solid #f97316',
        borderRadius: '12px',
        color: '#f8fafc',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px'
        }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>
            {isSummary
              ? '🌍 Selected Geographic Activity'
              : '🔥 Selected Satellite Observation'}
          </h3>

          <p style={{ color: '#cbd5e1' }}>
            NASA FIRMS —{' '}
            {satelliteLabels[observation.satellite] ||
              observation.satellite ||
              'Geographic Summary'}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close observation details"
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid #64748b',
            backgroundColor: '#334155',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '14px',
          marginTop: '16px'
        }}
      >
        {isSummary ? (
          <>
            <ObservationField label="Satellite Observations">
              {formatNumber(observation.count)}
            </ObservationField>

            <ObservationField label="Highest Fire Radiative Power">
              {observation.highestFRP != null
                ? `${Number(
                    observation.highestFRP
                  ).toFixed(2)} MW`
                : 'N/A'}
            </ObservationField>

            <ObservationField label="Latitude Range">
              {observation.south}° to {observation.north}°
            </ObservationField>

            <ObservationField label="Longitude Range">
              {observation.west}° to {observation.east}°
            </ObservationField>
          </>
        ) : (
          <>
            <ObservationField label="Observation Time (Local)">
              {formatTime(observation.observedAt)}
            </ObservationField>

            <ObservationField label="Observation Time (UTC)">
              {formatTime(observation.observedAt, true)}
            </ObservationField>

            <ObservationField label="Fire Radiative Power">
              {observation.frp != null
                ? `${observation.frp} MW`
                : 'N/A'}
            </ObservationField>

            <ObservationField label="Confidence">
              {observation.confidence ?? 'N/A'}
            </ObservationField>

            <ObservationField label="Latitude">
              {observation.latitude}
            </ObservationField>

            <ObservationField label="Longitude">
              {observation.longitude}
            </ObservationField>
          </>
        )}
      </div>

      {isSummary && (
        <button
          type="button"
          onClick={() => onExplore(observation)}
          style={{
            marginTop: '20px',
            padding: '12px 20px',
            backgroundColor: '#f97316',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          🔎 Explore This Area
        </button>
      )}

      <p
        style={{
          marginTop: '20px',
          marginBottom: 0,
          paddingTop: '14px',
          borderTop: '1px solid #475569',
          color: '#cbd5e1',
          fontSize: '13px'
        }}
      >
        {isSummary ? (
  'This geographic summary represents satellite observations within an area, not individual wildfires.'
) : (
  <>
    A satellite hotspot detection does not necessarily
    represent a separate wildfire.
    <br />
    <br />
    <strong>About observation times:</strong> The timestamps
    indicate when the satellite detected the hotspot,
    not the current time. Local time is displayed using
    your device's time zone, while UTC is the standardized
    global time reference.
  </>
)}
      </p>
    </div>
  )
}

// ==================================================
// MAIN APPLICATION
// ==================================================

function App() {
  const [selectedSatellite, setSelectedSatellite] =
    useState('NOAA20')

  const [selectedPeriod, setSelectedPeriod] =
    useState('24')

  const [liveHotspots, setLiveHotspots] =
    useState([])

  const [summaryCells, setSummaryCells] =
    useState([])

  const [selectedObservation, setSelectedObservation] =
    useState(null)
// Geographic area investigation
const [selectedArea, setSelectedArea] = useState(null)
const [areaDetections, setAreaDetections] = useState([])
const [areaLoading, setAreaLoading] = useState(false)
const [areaError, setAreaError] = useState('')
const [areaCheckedAt, setAreaCheckedAt] = useState(null)
const [areaExpanded, setAreaExpanded] = useState(true)
  const [mapLoading, setMapLoading] =
    useState(true)

  const [mapError, setMapError] =
    useState('')

  const [tileWarning, setTileWarning] =
    useState('')

  const [matchingCount, setMatchingCount] =
    useState(null)

  const [aggregatedCount, setAggregatedCount] =
    useState(null)

  const [lastChecked, setLastChecked] =
    useState(null)

  const [lastObservation, setLastObservation] =
    useState(null)

  const [refreshVersion, setRefreshVersion] =
    useState(0)

  const [searchText, setSearchText] =
    useState('')

  const [searchLocation, setSearchLocation] =
    useState(null)

  const [searchLoading, setSearchLoading] =
    useState(false)

  const [searchError, setSearchError] =
    useState('')

  const [mapTarget, setMapTarget] =
    useState(null)

  const [mapMode, setMapMode] =
    useState('world')

  const [viewport, setViewport] =
    useState(null)

  const [requestViewport, setRequestViewport] =
    useState(null)

  const [loadedTileCount, setLoadedTileCount] =
    useState(0)

  const [requiredTileCount, setRequiredTileCount] =
    useState(0)

  const [tileCoverageComplete, setTileCoverageComplete] =
    useState(true)

  const tileCacheRef = useRef(new Map())

  const handleObservationSelect = useCallback(
    (observation) => {
      setSelectedObservation(observation)
    },
    []
  )

  // Clear selection only when filters change.
  useEffect(() => {
    setSelectedObservation(null)
    setSelectedArea(null)
    setAreaDetections([])
    setAreaError('')
    setAreaCheckedAt(null)
  }, [selectedSatellite, selectedPeriod])

  const zoom = viewport?.zoom ?? 2
  const isSummaryView = zoom < DETAIL_ZOOM

  const requestViewType =
    requestViewport?.zoom >= DETAIL_ZOOM
      ? 'detail'
      : 'summary'

  const visibleTiles = useMemo(
    () =>
      requestViewType === 'detail'
        ? getVisibleTiles(requestViewport)
        : [],
    [requestViewport, requestViewType]
  )

  // Stable geographic tile identity.
  const visibleTileKey = useMemo(
    () =>
      requestViewType === 'summary'
        ? 'summary'
        : visibleTiles
            .map((tile) => tile.id)
            .sort()
            .join('|'),
    [visibleTiles, requestViewType]
  )

  const handleViewportChange = useCallback(
    (nextViewport) => {
      setViewport(nextViewport)
    },
    []
  )

  useEffect(() => {
    if (!viewport) return

    const timer = setTimeout(() => {
      setRequestViewport(viewport)
    }, VIEWPORT_DELAY_MS)

    return () => clearTimeout(timer)
  }, [viewport])

  useEffect(() => {
    const timer = setInterval(() => {
      setRefreshVersion((value) => value + 1)
    }, REFRESH_MS)

    return () => clearInterval(timer)
  }, [])

  // ==================================================
  // NASA DATA LOADING
  // ==================================================

  useEffect(() => {
    if (!requestViewport) return

    const controller = new AbortController()

    async function loadFireData() {
      setMapLoading(true)
      setMapError('')
      setTileWarning('')

      const satellites = getSatellites(
        selectedSatellite
      )

      const timeParams = getTimeParams(
        selectedPeriod
      )

      try {
        // ------------------------------------------
        // WORLDWIDE SUMMARY
        // ------------------------------------------

        if (requestViewType === 'summary') {
          const responses = await Promise.all(
            satellites.map(async (satellite) => {
              const params = new URLSearchParams({
                satellite,
                ...timeParams
              })

              const response = await fetch(
                `${API_BASE}/api/fire-summary?${params}`,
                { signal: controller.signal }
              )

              if (!response.ok) {
                throw new Error(
                  `Unable to load ${satellite} summary (${response.status})`
                )
              }

              const data = await response.json()

              if (
                data.isDemo ||
                !Array.isArray(data.gridCells)
              ) {
                throw new Error(
                  'Unexpected NASA summary response.'
                )
              }

              return { satellite, data }
            })
          )

          if (controller.signal.aborted) return

          const cells = responses.flatMap(
            ({ satellite, data }) =>
              data.gridCells.map((cell) => ({
                ...cell,
                satellite
              }))
          )

          const totalMatching = responses.reduce(
            (sum, item) =>
              sum +
              Number(item.data.matchingCount || 0),
            0
          )

          const totalAggregated = responses.reduce(
            (sum, item) =>
              sum +
              Number(item.data.aggregatedCount || 0),
            0
          )

          if (totalMatching !== totalAggregated) {
            throw new Error(
              'Summary observation counts do not match.'
            )
          }

          const checks = responses
            .map((item) => item.data.checkedAt)
            .filter(Boolean)

          setSummaryCells(cells)
          setLiveHotspots([])
          setMatchingCount(totalMatching)
          setAggregatedCount(totalAggregated)
          setLoadedTileCount(0)
          setRequiredTileCount(0)
          setTileCoverageComplete(true)
          setLastObservation(null)
          setLastChecked(
            checks.length ? checks.sort()[0] : null
          )

          return
        }

        // ------------------------------------------
        // INDIVIDUAL DETECTION TILES
        // ------------------------------------------

        const totalTiles = visibleTiles.length

        setRequiredTileCount(totalTiles)

        if (totalTiles === 0) {
          throw new Error(
            'No valid geographic tiles are visible.'
          )
        }

        if (totalTiles > MAX_VISIBLE_TILES) {
          setLiveHotspots([])
          setSummaryCells([])
          setMatchingCount(null)
          setAggregatedCount(null)
          setLastObservation(null)
          setLastChecked(null)
          setLoadedTileCount(0)
          setTileCoverageComplete(false)

          setTileWarning(
            `This view spans ${totalTiles} geographic tiles. ` +
            `Zoom in further to load detailed observations ` +
            `(maximum ${MAX_VISIBLE_TILES} tiles per view).`
          )

          return
        }

        const tasks = []

        for (const satellite of satellites) {
          for (const tile of visibleTiles) {
            tasks.push(async () => {
              const cacheKey = [
                satellite,
                selectedPeriod,
                tile.id
              ].join(':')

              const cached =
                tileCacheRef.current.get(cacheKey)

              if (
                cached &&
                Date.now() - cached.savedAt < REFRESH_MS &&
                cached.refreshVersion === refreshVersion
              ) {
                return {
                  satellite,
                  tile,
                  data: cached.data
                }
              }

              const params = new URLSearchParams({
                satellite,
                ...timeParams,
                x: String(tile.x),
                y: String(tile.y)
              })

              const response = await fetch(
                `${API_BASE}/api/fire-tile?${params}`,
                { signal: controller.signal }
              )

              if (!response.ok) {
                throw new Error(
                  `Tile ${tile.id} (${satellite}) failed (${response.status})`
                )
              }

              const data = await response.json()

              if (
                data.isDemo ||
                !Array.isArray(data.detections) ||
                data.sampleOnly !== false ||
                data.allMatchingObservationsReturned !== true ||
                Number(data.matchingCount) !==
                  data.detections.length
              ) {
                throw new Error(
                  `Tile ${tile.id} returned incomplete or unexpected observation data.`
                )
              }

              if (controller.signal.aborted) {
                throw new DOMException(
                  'Request cancelled',
                  'AbortError'
                )
              }

              tileCacheRef.current.set(cacheKey, {
                data,
                savedAt: Date.now(),
                refreshVersion
              })

              return { satellite, tile, data }
            })
          }
        }

        const results = await fetchWithConcurrency(
          tasks,
          MAX_CONCURRENT_REQUESTS,
          controller.signal
        )

        if (controller.signal.aborted) return

        const detections = results.flatMap(
          ({ satellite, data }) =>
            data.detections.map((spot) => ({
              ...spot,
              satellite
            }))
        )

        const totalMatching = results.reduce(
          (sum, item) =>
            sum + Number(item.data.matchingCount || 0),
          0
        )

        const observations = detections
          .map((spot) => spot.observedAt)
          .filter(Boolean)

        const checks = results
          .map((item) => item.data.checkedAt)
          .filter(Boolean)

        setLiveHotspots(detections)
        setSummaryCells([])
        setMatchingCount(totalMatching)
        setAggregatedCount(null)
        setLoadedTileCount(totalTiles)
        setTileCoverageComplete(true)

        setLastObservation(
          observations.length
            ? observations.sort().at(-1)
            : null
        )

        setLastChecked(
          checks.length ? checks.sort()[0] : null
        )
      } catch (error) {
        if (controller.signal.aborted) return

        setMapError(
          error.message ||
            'Unable to load NASA observations.'
        )

        setLiveHotspots([])
        setSummaryCells([])
        setMatchingCount(null)
        setAggregatedCount(null)
        setLastChecked(null)
        setLastObservation(null)
        setLoadedTileCount(0)
        setTileCoverageComplete(false)
      } finally {
        if (!controller.signal.aborted) {
          setMapLoading(false)
        }
      }
    }

    loadFireData()

    return () => controller.abort()
    // The tile key deliberately replaces the full viewport
    // as the loading dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedSatellite,
    selectedPeriod,
    visibleTileKey,
    requestViewType,
    refreshVersion
  ])


  // ==================================================
  // GEOGRAPHIC AREA INVESTIGATION
  // ==================================================

  function exploreSelectedArea(cell) {
    const south = Number(cell.south)
    const north = Number(cell.north)
    const west = Number(cell.west)
    const east = Number(cell.east)

    if (
      ![south, north, west, east].every(Number.isFinite) ||
      south >= north ||
      west >= east ||
      !getSatellites(selectedSatellite).includes(cell.satellite)
    ) {
      return
    }

    setSelectedArea({
      ...cell,
      south,
      north,
      west,
      east,
      period: selectedPeriod
    })

    setAreaDetections([])
    setAreaError('')
    setAreaCheckedAt(null)
    setAreaExpanded(true)
    setMapMode('regional')

    setMapTarget({
      latitude: (south + north) / 2,
      longitude: (west + east) / 2,
      zoom: 6,
      requestId: Date.now()
    })
  }

  function returnToSelectedArea() {
    if (!selectedArea) return

    setMapMode('regional')

    setMapTarget({
      latitude: (selectedArea.south + selectedArea.north) / 2,
      longitude: (selectedArea.west + selectedArea.east) / 2,
      zoom: 6,
      requestId: Date.now()
    })
  }

function exportAreaCSV() {
  if (
    !selectedArea ||
    areaLoading ||
    areaError ||
    !areaCheckedAt ||
    areaDetections.length === 0
  ) {
    return
  }

  const columns = [
    'latitude',
    'longitude',
    'date',
    'time',
    'observedAt',
    'satellite',
    'frp',
    'confidence'
  ]

  function escapeCSV(value) {
    if (value === null || value === undefined) {
      return ''
    }

    let text = String(value)

    // Prevent spreadsheet software from treating
    // untrusted text fields as executable formulas.
    if (/^[\s]*[=+\-@\t\r]/.test(text)) {
      text = "'" + text
    }

    return `"${text.replace(/"/g, '""')}"`
  }

  const rows = [
    columns.join(','),
    ...areaDetections.map((spot) =>
      columns
        .map((column) => escapeCSV(spot[column]))
        .join(',')
    )
  ]

  const csv = '\uFEFF' + rows.join('\r\n')

  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;'
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  const filename = [
    'firewatch',
    'area',
    selectedArea.satellite,
    selectedArea.period,
    `${selectedArea.south}_${selectedArea.west}`,
    new Date().toISOString().slice(0, 10)
  ]
    .join('_')
    .replace(/[^a-zA-Z0-9_.-]/g, '_') + '.csv'

  link.href = url
  link.download = filename

  document.body.appendChild(link)
  link.click()
  link.remove()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

  function clearSelectedArea() {
    setSelectedArea(null)
    setAreaDetections([])
    setAreaError('')
    setAreaCheckedAt(null)
  }

  useEffect(() => {
    if (!selectedArea) return

    const controller = new AbortController()

    async function loadSelectedArea() {
      setAreaLoading(true)
      setAreaError('')
      setAreaDetections([])
      setAreaCheckedAt(null)

      try {
        const tiles = getVisibleTiles({
          west: selectedArea.west,
          east: selectedArea.east,
          south: selectedArea.south,
          north: selectedArea.north
        })

        if (!tiles.length || tiles.length > MAX_VISIBLE_TILES) {
          throw new Error(
            'Unable to determine the selected geographic tiles.'
          )
        }

        const timeParams = getTimeParams(selectedArea.period)

        const tasks = tiles.map((tile) => async () => {
          const cacheKey = [
            selectedArea.satellite,
            selectedArea.period,
            tile.id
          ].join(':')

          const cached = tileCacheRef.current.get(cacheKey)

          if (
            cached &&
            Date.now() - cached.savedAt < REFRESH_MS &&
            cached.refreshVersion === refreshVersion
          ) {
            return cached.data
          }

          const params = new URLSearchParams({
            satellite: selectedArea.satellite,
            ...timeParams,
            x: String(tile.x),
            y: String(tile.y)
          })

          const response = await fetch(
            `${API_BASE}/api/fire-tile?${params}`,
            { signal: controller.signal }
          )

          if (!response.ok) {
            throw new Error(
              `Investigation tile ${tile.id} failed (${response.status}).`
            )
          }

          const data = await response.json()

          if (
            data.isDemo ||
            !Array.isArray(data.detections) ||
            data.sampleOnly !== false ||
            data.allMatchingObservationsReturned !== true ||
            Number(data.matchingCount) !== data.detections.length
          ) {
            throw new Error(
              `Investigation tile ${tile.id} returned incomplete data.`
            )
          }

          if (controller.signal.aborted) {
            throw new DOMException('Request cancelled', 'AbortError')
          }

          tileCacheRef.current.set(cacheKey, {
            data,
            savedAt: Date.now(),
            refreshVersion
          })

          return data
        })

        const results = await fetchWithConcurrency(
          tasks,
          MAX_CONCURRENT_REQUESTS,
          controller.signal
        )

        if (controller.signal.aborted) return

        const inside = results
          .flatMap((data) => data.detections)
          .filter((spot) => {
            const lat = Number(spot.latitude)
            const lon = Number(spot.longitude)

            return (
              Number.isFinite(lat) &&
              Number.isFinite(lon) &&
              lat >= selectedArea.south &&
              lat < selectedArea.north &&
              lon >= selectedArea.west &&
              lon < selectedArea.east
            )
          })
          .map((spot) => ({
            ...spot,
            satellite: selectedArea.satellite
          }))

        const checks = results
          .map((data) => data.checkedAt)
          .filter(Boolean)

        setAreaDetections(inside)
        setAreaCheckedAt(
          checks.length ? checks.sort()[0] : null
        )
      } catch (error) {
        if (controller.signal.aborted) return

        setAreaError(
          error.message ||
          'Unable to load selected-area observations.'
        )
      } finally {
        if (!controller.signal.aborted) {
          setAreaLoading(false)
        }
      }
    }

    loadSelectedArea()

    return () => controller.abort()
  }, [selectedArea, refreshVersion])

  // Preserve the selected area's observations when the user pans.
  const displayedHotspots = useMemo(() => {
    if (!selectedArea || !areaDetections.length) {
      return liveHotspots
    }

    const combined = new Map()

    for (const spot of [...liveHotspots, ...areaDetections]) {
      const key = [
        spot.satellite,
        spot.latitude,
        spot.longitude,
        spot.observedAt,
        spot.frp,
        spot.confidence
      ].join('|')

      if (!combined.has(key)) {
        combined.set(key, spot)
      }
    }

    return Array.from(combined.values())
  }, [liveHotspots, areaDetections, selectedArea])

  // ==================================================
  // LOCATION SEARCH
  // ==================================================

  async function handleLocationSearch(event) {
    event.preventDefault()

    const query = searchText.trim()
    if (!query || searchLoading) return

    setSearchLoading(true)
    setSearchError('')

    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: '1'
      })

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`
      )

      if (!response.ok) {
        throw new Error(
          'Location search is temporarily unavailable.'
        )
      }

      const results = await response.json()

      if (!Array.isArray(results) || !results.length) {
        setSearchError(
          'Location not found. Try adding a city, state, or country.'
        )
        return
      }

      const result = results[0]
      const latitude = Number(result.lat)
      const longitude = Number(result.lon)

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        throw new Error('Invalid location coordinates.')
      }

      const location = {
        latitude,
        longitude,
        name: result.display_name || query
      }

      setSearchLocation(location)
      setMapMode('regional')

      setMapTarget({
        latitude,
        longitude,
        zoom: 10,
        requestId: Date.now()
      })
    } catch (error) {
      setSearchError(
        error.message ||
          'Unable to search for that location.'
      )
    } finally {
      setSearchLoading(false)
    }
  }

  function returnToWorldwide() {
    clearSelectedArea()
    setMapMode('world')
    setSearchLocation(null)
    setSearchText('')
    setSearchError('')

    setMapTarget({
      latitude: 15,
      longitude: 0,
      zoom: 2,
      requestId: Date.now()
    })
  }

  function refreshNow() {
    if (mapLoading) return

    setRefreshVersion((value) => value + 1)
  }

  // ==================================================
  // VISIBLE MAP STATISTICS
  // ==================================================

  const visibleHotspots = useMemo(() => {
    if (!viewport) return []

    return liveHotspots.filter((spot) => {
      const lat = Number(spot.latitude)
      const lon = Number(spot.longitude)

      return (
        lat >= viewport.south &&
        lat <= viewport.north &&
        lon >= viewport.west &&
        lon <= viewport.east
      )
    })
  }, [liveHotspots, viewport])

  const visibleSummaryCells = useMemo(() => {
    if (!viewport) return []

    return summaryCells.filter((cell) => {
      const lat = Number(cell.latitude)
      const lon = Number(cell.longitude)

      return (
        lat >= viewport.south &&
        lat <= viewport.north &&
        lon >= viewport.west &&
        lon <= viewport.east
      )
    })
  }, [summaryCells, viewport])

  const visibleSummaryCount = visibleSummaryCells.reduce(
    (sum, cell) => sum + Number(cell.count || 0),
    0
  )

  const highestFRP = useMemo(() => {
    const source = isSummaryView
      ? visibleSummaryCells
      : visibleHotspots

    let highest = null

    for (const item of source) {
      const raw = isSummaryView
        ? item.highestFRP
        : item.frp

      const value = Number(raw)

      if (
        raw === null ||
        raw === undefined ||
        raw === '' ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        continue
      }

      if (highest === null || value > highest) {
        highest = value
      }
    }

    return highest === null
      ? null
      : highest.toFixed(2)
  }, [
    isSummaryView,
    visibleSummaryCells,
    visibleHotspots
  ])

  // ==================================================
  // FIRE ACTIVITY ANALYTICS
  // ==================================================

  const analyticsReady =
    !mapLoading &&
    !mapError &&
    !tileWarning &&
    (isSummaryView || tileCoverageComplete)

  // The summary view contains geographic cell counts.
  // The detail view contains individual observations.
  const satelliteBreakdown = useMemo(() => {
    const counts = {
      MODIS: 0,
      NOAA20: 0,
      NOAA21: 0
    }

    const source = isSummaryView
      ? visibleSummaryCells
      : visibleHotspots

    for (const item of source) {
      if (!(item.satellite in counts)) continue

      counts[item.satellite] += isSummaryView
        ? Number(item.count) || 0
        : 1
    }

    return counts
  }, [isSummaryView, visibleSummaryCells, visibleHotspots])

  const satelliteTotal = Object.values(
    satelliteBreakdown
  ).reduce((sum, count) => sum + count, 0)

  const frpAnalytics = useMemo(() => {
    // Average FRP requires individual observation records.
    if (isSummaryView) {
      return {
        average: null,
        highestObservation: null,
        validCount: 0
      }
    }

    let total = 0
    let validCount = 0
    let highestObservation = null

    for (const spot of visibleHotspots) {
      const raw = spot.frp

      if (
        raw === null ||
        raw === undefined ||
        raw === ''
      ) {
        continue
      }

      const frp = Number(raw)

      if (!Number.isFinite(frp) || frp < 0) {
        continue
      }

      total += frp
      validCount++

      if (
        highestObservation === null ||
        frp > Number(highestObservation.frp)
      ) {
        highestObservation = spot
      }
    }

    return {
      average: validCount > 0
        ? total / validCount
        : null,
      highestObservation,
      validCount
    }
  }, [isSummaryView, visibleHotspots])

  
  const stats = [
    {
      label: isSummaryView
        ? 'Observations in visible summary cells'
        : 'Visible detections',
      value: analyticsReady
        ? formatNumber(
            isSummaryView
              ? visibleSummaryCount
              : visibleHotspots.length
          )
        : '—'
    },
    {
      label: 'Highest FRP',
      value: analyticsReady
        ? highestFRP !== null
          ? `${highestFRP} MW`
          : 'N/A'
        : '—'
    },
    {
      label: 'Average FRP',
      value: !analyticsReady
        ? '—'
        : isSummaryView
          ? 'Zoom in for details'
          : frpAnalytics.average !== null
            ? `${frpAnalytics.average.toFixed(2)} MW`
            : 'N/A'
    },
    {
      label: 'Satellite',
      value: selectedSatellite === 'ALL'
        ? 'All satellites'
        : satelliteLabels[selectedSatellite]
    },
    {
      label: 'Observation period',
      value: periodLabel(selectedPeriod)
    }
  ]

  // ==================================================
  // RENDER
  // ==================================================

  return (
    <main>
      <header>
        <h1>🔥 FireWatch</h1>
        <p>NASA Satellite Fire Activity Dashboard</p>
      </header>

      <section>
        <h2>Welcome to FireWatch</h2>
        <p>
          Explore satellite hotspot detections and
          historical fire activity from NASA FIRMS.
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
          Explore recent satellite-detected thermal
          hotspots around the world. Zoom out for
          geographic summaries, or zoom in to explore
          individual satellite observations.
        </p>

        {/* SATELLITE FILTERS */}

        <div className="map-filter-panel">
          <h3>Satellite Observations</h3>

          <div className="map-filter-options">
            {Object.keys(satelliteLabels).map((value) => (
              <label
                key={value}
                className="map-filter-option"
              >
                <input
                  type="radio"
                  name="mapSatellite"
                  value={value}
                  checked={selectedSatellite === value}
                  onChange={() =>
                    setSelectedSatellite(value)
                  }
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

        {/* TIME FILTERS */}

        <div className="map-time-panel">
          <h3>🕒 Recent Satellite Observations</h3>

          <p className="map-time-description">
            Near Live shows observations available for
            the current UTC day. Rolling windows include
            recent observations across UTC midnight.
          </p>

          <div className="map-time-options">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  selectedPeriod === option.value
                    ? 'map-time-button active'
                    : 'map-time-button'
                }
                onClick={() =>
                  setSelectedPeriod(option.value)
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className="map-time-status">
            Selected:{' '}
            <strong>
              {periodLabel(selectedPeriod)}
            </strong>
          </p>
        </div>

        {/* LOCATION SEARCH */}

        <div
          style={{
            padding: '18px',
            margin: '18px 0',
            border: '1px solid #475569',
            borderRadius: '12px'
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            🔎 Search for a Location
          </h3>

          <p>
            Enter a city, state, country, or place to
            explore recent NASA satellite observations.
          </p>

          <form
            onSubmit={handleLocationSearch}
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap'
            }}
          >
            <input
              type="search"
              value={searchText}
              onChange={(event) =>
                setSearchText(event.target.value)
              }
              placeholder="e.g. New York City, USA"
              aria-label="Search for a location"
              style={{
                flex: '1 1 220px',
                minWidth: 0,
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #64748b',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                fontSize: '16px'
              }}
            />

            <button
              type="submit"
              disabled={
                searchLoading || !searchText.trim()
              }
              style={{
                padding: '12px 20px',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: '#f97316',
                color: '#ffffff',
                fontWeight: 'bold',
                cursor: searchLoading
                  ? 'wait'
                  : 'pointer'
              }}
            >
              {searchLoading ? 'Searching...' : 'Search'}
            </button>
          </form>

          {searchError && (
            <p
              role="alert"
              style={{ color: '#fca5a5' }}
            >
              ⚠️ {searchError}
            </p>
          )}

          {searchLocation && (
            <p style={{ overflowWrap: 'anywhere' }}>
              📍 Showing: {searchLocation.name}
            </p>
          )}

          <p style={{ fontSize: '13px', opacity: 0.75 }}>
            Location search uses OpenStreetMap Nominatim.
            FireWatch loads NASA observations using
            geographic tiles covering the visible map.
          </p>
        </div>

        {/* SATELLITE MONITORING */}

        <div
          style={{
            padding: '18px',
            margin: '18px 0',
            border: '1px solid #475569',
            borderRadius: '12px'
          }}
        >
          <h3>🛰️ Satellite Monitoring</h3>

          <p>
            <strong>Navigation: </strong>
            {mapMode === 'regional'
              ? 'Searched location'
              : 'Worldwide exploration'}
          </p>

          <p>
            <strong>Map display: </strong>
            {isSummaryView
              ? 'Geographic activity summaries'
              : 'Individual satellite detections'}
          </p>

          <p>
            <strong>Zoom level: </strong>
            {zoom}
          </p>

          {!isSummaryView && (
            <p>
              <strong>Geographic tiles: </strong>
              {loadedTileCount} of {requiredTileCount} loaded
              {selectedSatellite === 'ALL'
                ? ' (three satellite datasets per tile)'
                : ''}
            </p>
          )}

          <p>
            FireWatch automatically checks for updated
            NASA satellite observations every 15 minutes
            while this page is open.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap'
            }}
          >
            <button
              type="button"
              disabled={mapLoading}
              onClick={refreshNow}
              style={{
                padding: '12px 18px',
                borderRadius: '8px',
                cursor: mapLoading
                  ? 'wait'
                  : 'pointer'
              }}
            >
              {mapLoading
                ? 'Checking...'
                : '🔄 Refresh Now'}
            </button>

            {(mapMode === 'regional' || zoom > 2) && (
              <button
                type="button"
                onClick={returnToWorldwide}
                style={{
                  padding: '12px 18px',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                🌍 Back to Worldwide
              </button>
            )}
          </div>

          <p>
            <strong>Last NASA data check (local): </strong>
            {formatTime(lastChecked)}
          </p>

          <p>
            <strong>
              Latest loaded satellite observation (UTC):
            </strong>{' '}
            {formatTime(lastObservation, true)}
          </p>

          {isSummaryView && (
            <p style={{ fontSize: '13px', opacity: 0.8 }}>
              Geographic summaries count qualifying
              observations but do not include individual
              observation timestamps. Zoom in to inspect
              detailed detections.
            </p>
          )}

          <p style={{ fontSize: '13px', opacity: 0.75 }}>
            Refresh Now may return cached observations
            for up to 15 minutes. Satellite observations
            are near-real-time, not continuous live
            wildfire tracking.
          </p>
        </div>

        {/* NASA DATA STATUS */}

        {mapLoading && (
          <p>🛰️ Loading NASA satellite data...</p>
        )}

        {mapError && (
          <p role="alert" style={{ color: '#fca5a5' }}>
            ⚠️ {mapError}
          </p>
        )}

        {tileWarning && !mapError && (
          <p role="status" style={{ color: '#fbbf24' }}>
            ⚠️ {tileWarning}
          </p>
        )}

        {!mapLoading && !mapError && !tileWarning && (
          <div>
            {isSummaryView ? (
              <>
                <p>
                  🌍 Displaying{' '}
                  <strong>
                    {formatNumber(summaryCells.length)}
                  </strong>{' '}
                  geographic activity cells.
                </p>

                <p>
                  🔥 Qualifying NASA observations:{' '}
                  <strong>
                    {formatNumber(matchingCount)}
                  </strong>
                </p>

                <p>
                  Observations represented in the
                  geographic grid:{' '}
                  <strong>
                    {formatNumber(aggregatedCount)}
                  </strong>
                </p>

                <p style={{ fontSize: '13px', opacity: 0.8 }}>
                  All qualifying observations contribute
                  to these geographic counts. Each circle
                  represents a geographic area, not an
                  individual fire.
                </p>
              </>
            ) : (
              <>
                <p>
                  🔥 Displaying{' '}
                  <strong>
                    {formatNumber(liveHotspots.length)}
                  </strong>{' '}
                  individual satellite detections from
                  loaded geographic tiles.
                </p>

                <p>
                  Qualifying observations in loaded tiles:{' '}
                  <strong>
                    {formatNumber(matchingCount)}
                  </strong>
                </p>

                <p>
                  <strong>Tile coverage: </strong>
                  {tileCoverageComplete
                    ? 'Complete for the requested visible tiles'
                    : 'Incomplete'}
                </p>

                <p style={{ fontSize: '13px', opacity: 0.8 }}>
                  Detailed data is not sampled by FireWatch.
                  Tile counts include observations outside
                  the exact viewport when a tile extends
                  beyond the map edges.
                </p>
              </>
            )}

            {selectedPeriod === 'live' &&
              matchingCount === 0 && (
                <p>
                  No observations are available for the
                  current UTC day in this selection yet.
                  Try Last 24 Hours.
                </p>
              )}
          </div>
        )}

        {/* INTERACTIVE FIRE MAP */}

        <MapContainer
          center={[15, 0]}
          zoom={2}
          minZoom={2}
          closePopupOnClick={true}
          maxBounds={[
            [-85, -230],
            [85, 230]
          ]}
          maxBoundsViscosity={0.5}
          scrollWheelZoom={true}
          preferCanvas={true}
          style={{
            height: '450px',
            width: '100%',
            borderRadius: '12px'
          }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            noWrap={true}
          />

          <MapViewportTracker
            onViewportChange={handleViewportChange}
          />

          <MapFlyTo target={mapTarget} />

          {searchLocation && (
            <Marker
              position={[
                searchLocation.latitude,
                searchLocation.longitude
              ]}
              icon={searchLocationIcon}
            >
              <Popup>
                <strong>📍 Searched location</strong>
                <p>{searchLocation.name}</p>
              </Popup>
            </Marker>
          )}


          {/* SELECTED GEOGRAPHIC CELL */}

          {selectedArea && !isSummaryView && (
            <Rectangle
              bounds={[
                [selectedArea.south, selectedArea.west],
                [selectedArea.north, selectedArea.east]
              ]}
              pathOptions={{
                color: '#f97316',
                weight: 3,
                dashArray: '8 6',
                fillColor: '#f97316',
                fillOpacity: 0.06,
                interactive: false
              }}
            />
          )}

          {/* WORLDWIDE SUMMARY CIRCLES */}

          {isSummaryView && !mapError && (
            <SummaryLayer
              cells={summaryCells}
              onSelect={handleObservationSelect}
            />
          )}

          {/* INDIVIDUAL SATELLITE HOTSPOTS */}

          {!isSummaryView &&
            (!mapError || selectedArea) &&
            (!tileWarning || selectedArea) && (
              <DetailLayer
                detections={displayedHotspots}
                onSelect={handleObservationSelect}
                selectedArea={selectedArea}
              />
            )}
        </MapContainer>

        {/* PERSISTENT PANEL BELOW MAP */}

        <ObservationPanel
          observation={selectedObservation}
          onClose={() => setSelectedObservation(null)}
          onExplore={exploreSelectedArea}
        />


        {/* GEOGRAPHIC AREA INVESTIGATION */}

        {selectedArea && (
          <div
            role="region"
            aria-label="Geographic area investigation"
            style={{
              marginTop: '16px',
              marginBottom: '20px',
              padding: '22px',
              backgroundColor: '#1e293b',
              border: '1px solid #f97316',
              borderRadius: '12px',
              color: '#f8fafc'
            }}
          >
            
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px'
  }}
>
  <h3 style={{ margin: 0 }}>
    🔎 Geographic Area Investigation
  </h3>

  <button
    type="button"
    onClick={() => setAreaExpanded((current) => !current)}
    aria-expanded={areaExpanded}
    aria-controls="firewatch-area-investigation-details"
    style={{
      padding: '10px 16px',
      border: '1px solid #64748b',
      borderRadius: '8px',
      backgroundColor: '#334155',
      color: '#ffffff',
      cursor: 'pointer',
      fontWeight: 'bold'
    }}
  >
    {areaExpanded ? '▲ Collapse' : '▼ Expand'}
  </button>
</div>

{!areaExpanded && (
  <p style={{ color: '#cbd5e1', marginBottom: 0 }}>
    Investigation active —{' '}
    {areaLoading
      ? 'loading observations'
      : areaError
        ? 'data unavailable'
        : `${formatNumber(areaDetections.length)} observations loaded`}
    . Expand to view details or export CSV.
  </p>
)}

<div
  id="firewatch-area-investigation-details"
  hidden={!areaExpanded}
>


            <p style={{ color: '#cbd5e1' }}>
              The dashed orange rectangle marks the original
              geographic cell. Yellow-outlined markers represent
              observations inside that area.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '14px',
                margin: '18px 0'
              }}
            >

              <ObservationField label="Individual Observations in Area">
                {areaLoading
                  ? 'Loading...'
                  : areaError
                    ? 'Unavailable'
                    : formatNumber(areaDetections.length)}
              </ObservationField>

              <ObservationField label="Satellite">
                {satelliteLabels[selectedArea.satellite] ||
                  selectedArea.satellite}
              </ObservationField>

              <ObservationField label="Observation Period">
                {periodLabel(selectedArea.period)}
              </ObservationField>
            </div>

            {areaLoading && (
              <p role="status">
                🛰️ Loading all tiles intersecting the selected area...
              </p>
            )}

            {areaError && (
              <p role="alert" style={{ color: '#fca5a5' }}>
                ⚠️ {areaError}
              </p>
            )}

           
{!areaLoading && !areaError && (
  <p
    role="status"
    style={{
      color:
        areaDetections.length === Number(selectedArea.count)
          ? '#86efac'
          : '#fbbf24'
    }}
  >
    {areaDetections.length === Number(selectedArea.count) ? (
      '✓ Map summary and detailed counts are consistent.'
    ) : (
      <>
        ⚠️ Observation counts differ. The data may have
        changed between requests.
        <br />
        Map summary: {formatNumber(selectedArea.count)}
        {' '}observations.
        <br />
        Retrieved: {formatNumber(areaDetections.length)}
        {' '}observations.
      </>
    )}
  </p>
)}

            {areaCheckedAt && (
              <p style={{ fontSize: '13px', opacity: 0.8 }}>
                Investigation data checked (UTC):{' '}
                {formatTime(areaCheckedAt, true)}
              </p>
            )}

            <p style={{ fontSize: '13px', opacity: 0.8 }}>
              Latitude: {selectedArea.south}° to{' '}
              {selectedArea.north}°. Longitude:{' '}
              {selectedArea.west}° to {selectedArea.east}°.
              A count match does not guarantee identical
              satellite data snapshots.
            </p>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap'
              }}
            >
              <button
                type="button"
                onClick={returnToSelectedArea}
                style={{
                  padding: '12px 18px',
                  border: 'none',
                  borderRadius: '8px',
                  backgroundColor: '#f97316',
                  color: '#ffffff',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                📍 Return to Selected Area
              </button>

<button
  type="button"
  onClick={exportAreaCSV}
  disabled={
    areaLoading ||
    Boolean(areaError) ||
    !areaCheckedAt ||
    areaDetections.length === 0
  }
  title={
    areaLoading
      ? 'Wait for all investigation observations to load'
      : areaError
        ? 'Investigation data is unavailable'
        : areaDetections.length === 0
          ? 'No observations available to export'
          : 'Download all loaded observations for this area'
  }
  style={{
    padding: '12px 18px',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    fontWeight: 'bold',
    cursor:
      areaLoading ||
      areaError ||
      !areaCheckedAt ||
      areaDetections.length === 0
        ? 'not-allowed'
        : 'pointer',
    opacity:
      areaLoading ||
      areaError ||
      !areaCheckedAt ||
      areaDetections.length === 0
        ? 0.5
        : 1
  }}
>
  ⬇ Export CSV ({formatNumber(areaDetections.length)})
</button>

              <button
                type="button"
                onClick={clearSelectedArea}
                style={{
                  padding: '12px 18px',
                  border: '1px solid #64748b',
                  borderRadius: '8px',
                  backgroundColor: '#334155',
                  color: '#ffffff',
                  cursor: 'pointer'
                }}
              >
                ✕ End Investigation
              </button>
            </div>
          </div>
          </div>
        )}

        {/* FIRE ACTIVITY OVERVIEW */}
        <div
          style={{
            marginTop: '18px',
            padding: '20px',
            border: '1px solid #475569',
            borderRadius: '12px'
          }}
        >
          <h3>📊 Fire Activity Overview</h3>

          <p>
            {isSummaryView
              ? 'Activity counts from geographic summary cells whose centers are visible in the map.'
              : 'Statistics for loaded individual NASA detections within the current map view.'}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px'
            }}
          >
            {stats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: '#1e293b',
                  padding: '16px',
                  borderRadius: '10px'
                }}
              >
                <p
                  style={{
                    color: '#cbd5e1',
                    margin: 0
                  }}
                >
                  {stat.label}
                </p>

                <h3
                  style={{
                    marginBottom: 0,
                    overflowWrap: 'anywhere'
                  }}
                >
                  {stat.value}
                </h3>
              </div>
            ))}
          </div>

<div
  style={{
    marginTop: '24px',
    paddingTop: '18px',
    borderTop: '1px solid #475569'
  }}
>
  <h3>🛰️ Observations by Satellite</h3>

  <p style={{ color: '#cbd5e1' }}>
    {isSummaryView
      ? 'Observations in geographic summary cells whose centers are visible on the map.'
      : 'Individual observations inside the current visible map boundaries.'}
  </p>

  {!analyticsReady ? (
    <p>Satellite statistics are loading or unavailable.</p>
  ) : (
    <>
      {['MODIS', 'NOAA20', 'NOAA21'].map((satellite) => {
        const count = satelliteBreakdown[satellite]
        const percentage = satelliteTotal > 0
          ? (count / satelliteTotal) * 100
          : 0

        return (
          <div
            key={satellite}
            style={{ marginBottom: '18px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
                marginBottom: '8px'
              }}
            >
              <span>{satelliteLabels[satellite]}</span>

              <strong>
                {formatNumber(count)} ({percentage.toFixed(1)}%)
              </strong>
            </div>

            <div
              style={{
                height: '12px',
                backgroundColor: '#334155',
                borderRadius: '999px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${percentage}%`,
                  backgroundColor: '#f97316',
                  borderRadius: '999px'
                }}
              />
            </div>
          </div>
        )
      })}

      <p style={{ fontSize: '13px', color: '#cbd5e1' }}>
        Satellite breakdown total:{' '}
        <strong>{formatNumber(satelliteTotal)}</strong>
      </p>
    </>
  )}
</div>

<div
  style={{
    marginTop: '22px',
    padding: '16px',
    backgroundColor: '#1e293b',
    borderRadius: '10px'
  }}
>
  <h3>🔥 Highest-FRP Observation</h3>

  {!analyticsReady ? (
    <p>Observation details are loading or unavailable.</p>
  ) : isSummaryView ? (
    <p>
      Zoom in to identify the individual observation
      with the highest fire radiative power.
    </p>
  ) : frpAnalytics.highestObservation ? (
    <>
      <p>
        <strong>FRP:</strong>{' '}
        {Number(
          frpAnalytics.highestObservation.frp
        ).toFixed(2)} MW
      </p>

      <p>
        <strong>Satellite:</strong>{' '}
        {satelliteLabels[
          frpAnalytics.highestObservation.satellite
        ] || frpAnalytics.highestObservation.satellite}
      </p>

      <p>
        <strong>Detected at (UTC):</strong>{' '}
        {formatTime(
          frpAnalytics.highestObservation.observedAt,
          true
        )}
      </p>

      <p>
        <strong>Coordinates:</strong>{' '}
        {frpAnalytics.highestObservation.latitude},{' '}
        {frpAnalytics.highestObservation.longitude}
      </p>
    </>
  ) : (
    <p>No valid FRP observations in the current view.</p>
  )}

  {analyticsReady && !isSummaryView && (
    <p style={{ fontSize: '13px', color: '#cbd5e1' }}>
      Average FRP is calculated from{' '}
      {formatNumber(frpAnalytics.validCount)}
      {' '}observations with valid FRP values.
      FRP measures radiative power, not the total
      size or severity of a wildfire.
    </p>
  )}
</div>

          <p style={{ fontSize: '13px', opacity: 0.75 }}>
            {isSummaryView
              ? 'Summary statistics use complete geographic cells. A cell can extend beyond the visible map edge, so these figures are not exact viewport-clipped totals.'
              : 'Detailed statistics reflect loaded detections visible on the map. Tile data is not sampled by FireWatch, but satellite coverage and upstream data availability may vary.'}
          </p>
        </div>

        {/* MAP LEGEND */}

        <div className="map-legend">
          <div className="map-legend-item">
            <span className="map-legend-dot"></span>

            <span>
              {isSummaryView
                ? 'Orange circles — geographic concentrations of NASA satellite observations'
                : 'Orange markers — individual NASA satellite hotspot detections'}
            </span>
          </div>

          <p>
            {isSummaryView
              ? 'Larger circles indicate more observations within a geographic cell. Zoom in for individual detections.'
              : 'Each marker represents a satellite observation, not necessarily a separate wildfire.'}
          </p>
        </div>

        {/* SATELLITE INFORMATION */}

        <div className="map-satellite-info">
          <h3>🛰️ Why Are Different Satellites Used?</h3>

          <p>
            FireWatch uses historical MODIS and VIIRS
            Suomi NPP observations to explore past fire
            activity from 2015–2026.
          </p>

          <p>
            The recent detection map uses MODIS
            (Terra and Aqua), VIIRS NOAA-20, and
            VIIRS NOAA-21 observations.
          </p>

          <p>
            Different satellites can observe the same
            area at different times.
          </p>

          <p className="map-satellite-disclaimer">
            Satellite hotspots are not necessarily
            individual wildfires. The same fire may be
            detected multiple times or by different
            satellites.
          </p>
        </div>
      </section>

      {/* HISTORICAL CHART */}

      <section>
        <h2>📊 Historical Fire Activity</h2>

        <p>
          Explore NASA satellite fire detections
          from 2015–2026.
        </p>

        <HistoricalChart />
      </section>

      {/* FIRE CALENDAR */}

      <section className="card">
        <FireCalendar />
      </section>
    </main>
  )
}

export default App