// ==================================================
// FIREWATCH — CLOUDFLARE WORKER
// NASA FIRMS satellite observations
//
// Endpoints:
// /api/calendar      Demo calendar
// /api/fires         Raw NASA CSV testing
// /api/fire-map      Sampled individual observations
// /api/fire-summary  Complete geographic summaries
// /api/fire-tile     NEW: Cached, unsampled geographic tile
// ==================================================

const SATELLITES = {
  MODIS: "MODIS_NRT",
  NOAA20: "VIIRS_NOAA20_NRT",
  NOAA21: "VIIRS_NOAA21_NRT",
};

const MAX_MAP_DETECTIONS = 5000;
const CACHE_SECONDS = 900;
const DAY_MS = 24 * 60 * 60 * 1000;

const SUMMARY_GRID_DEGREES = 5;

// NEW: Each tile covers 10 degrees latitude
// and 10 degrees longitude.
const TILE_DEGREES = 10;
const TILE_COLUMNS = 360 / TILE_DEGREES;
const TILE_ROWS = 180 / TILE_DEGREES;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

// --------------------------------------------------
// SATELLITE AND TIME VALIDATION
// --------------------------------------------------

function getRequestOptions(url) {
  const satellite =
    url.searchParams.get("satellite") || "NOAA20";

  const mode =
    url.searchParams.get("mode") || "rolling";

  const daysText =
    url.searchParams.get("days") || "1";

  const days = Number(daysText);

  if (!Object.hasOwn(SATELLITES, satellite)) {
    throw new Error("Invalid satellite selection");
  }

  if (!["live", "rolling"].includes(mode)) {
    throw new Error("Mode must be live or rolling");
  }

  if (![1, 2, 3].includes(days)) {
    throw new Error("Days must be 1, 2, or 3");
  }

  return {
    satellite,
    mode,
    days: mode === "live" ? 1 : days,
  };
}

function getObservationWindow(mode, days, nowMs) {
  let windowStartMs;
  let nasaDays;
  let windowType;
  let windowHours;

  if (mode === "live") {
    const now = new Date(nowMs);

    windowStartMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );

    nasaDays = 1;
    windowType = "current_utc_day";

    windowHours =
      (nowMs - windowStartMs) / (60 * 60 * 1000);
  } else {
    windowStartMs = nowMs - days * DAY_MS;

    // Extra NASA calendar day ensures rolling
    // windows can cross UTC midnight.
    nasaDays = days + 1;

    windowType = "rolling";
    windowHours = days * 24;
  }

  return {
    windowStartMs,
    windowEndMs: nowMs,
    nasaDays,
    windowType,
    windowHours,
  };
}

// --------------------------------------------------
// GEOGRAPHIC BOUNDING BOX
// --------------------------------------------------

function parseBoundingBox(value) {
  if (value === null) {
    return {
      area: "world",
      bounds: null,
    };
  }

  const parts = value.split(",");

  if (parts.length !== 4) {
    throw new Error(
      "Bounding box must contain west,south,east,north"
    );
  }

  const numbers = parts.map((part) => {
    if (part.trim() === "") return NaN;
    return Number(part);
  });

  if (numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(
      "Bounding box coordinates must be valid numbers"
    );
  }

  const [west, south, east, north] = numbers;

  if (
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    throw new Error("Invalid geographic bounding box");
  }

  return {
    area: numbers.join(","),
    bounds: {
      west,
      south,
      east,
      north,
    },
  };
}

// --------------------------------------------------
// NEW: FIXED GEOGRAPHIC TILES
// --------------------------------------------------
//
// A 10-degree world grid:
//
// x: 0 through 35, west to east
// y: 0 through 17, south to north
//
// Tile (0,0):
// west -180, south -90, east -170, north -80
//
// Tile (18,9):
// west 0, south 0, east 10, north 10
//
// Fixed boundaries allow cache reuse when
// someone pans within or revisits a tile.

function parseTile(url) {
  const xText = url.searchParams.get("x");
  const yText = url.searchParams.get("y");

  if (
    xText === null ||
    yText === null ||
    !/^\d+$/.test(xText) ||
    !/^\d+$/.test(yText)
  ) {
    throw new Error(
      "Tile requests require integer x and y coordinates"
    );
  }

  const x = Number(xText);
  const y = Number(yText);

  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    x < 0 ||
    x >= TILE_COLUMNS ||
    y < 0 ||
    y >= TILE_ROWS
  ) {
    throw new Error(
      `Tile coordinates must have x=0-${TILE_COLUMNS - 1} and y=0-${TILE_ROWS - 1}`
    );
  }

  const west = -180 + x * TILE_DEGREES;
  const south = -90 + y * TILE_DEGREES;

  const east = west + TILE_DEGREES;
  const north = south + TILE_DEGREES;

  return {
    x,
    y,
    id: `${x}-${y}`,
    bounds: {
      west,
      south,
      east,
      north,
    },
    area: `${west},${south},${east},${north}`,
  };
}

// Check whether a detection belongs to this tile.
//
// The upper/right edges are exclusive except
// at the outer world boundaries.
//
// This prevents duplicate observations when
// adjacent tile results are combined.

function belongsToTile(spot, tile) {
  const { west, south, east, north } = tile.bounds;

  return (
    spot.latitude >= south &&
    (spot.latitude < north ||
      (north === 90 && spot.latitude === 90)) &&
    spot.longitude >= west &&
    (spot.longitude < east ||
      (east === 180 && spot.longitude === 180))
  );
}

// --------------------------------------------------
// NASA OBSERVATION TIMESTAMPS
// --------------------------------------------------

function parseObservationTime(date, time) {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return null;
  }

  const rawTime = String(time ?? "").trim();

  if (!/^\d{1,4}$/.test(rawTime)) {
    return null;
  }

  const padded = rawTime.padStart(4, "0");

  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2, 4));

  if (hours > 23 || minutes > 59) {
    return null;
  }

  const iso =
    `${date}T${padded.slice(0, 2)}:` +
    `${padded.slice(2, 4)}:00.000Z`;

  const timestamp = Date.parse(iso);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  if (new Date(timestamp).toISOString() !== iso) {
    return null;
  }

  return timestamp;
}

// --------------------------------------------------
// PARSE NASA CSV WITHOUT SAMPLING
// --------------------------------------------------

function parseFireCSV(
  csv,
  satellite,
  windowStartMs,
  windowEndMs
) {
  const lines = csv.trim().split(/\r?\n/);

  if (lines.length < 2) {
    return [];
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

  if (
    latitudeIndex === -1 ||
    longitudeIndex === -1 ||
    dateIndex === -1 ||
    timeIndex === -1
  ) {
    throw new Error("Unexpected NASA data format");
  }

  const detections = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");

    const latitudeText =
      values[latitudeIndex]?.trim();

    const longitudeText =
      values[longitudeIndex]?.trim();

    if (!latitudeText || !longitudeText) {
      continue;
    }

    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      continue;
    }

    const date = values[dateIndex]?.trim();
    const time = values[timeIndex]?.trim();

    const observationMs =
      parseObservationTime(date, time);

    if (
      observationMs === null ||
      observationMs < windowStartMs ||
      observationMs > windowEndMs
    ) {
      continue;
    }

    const frpText =
      frpIndex >= 0
        ? values[frpIndex]?.trim()
        : null;

    const frp =
      frpText &&
      Number.isFinite(Number(frpText))
        ? Number(frpText)
        : null;

    detections.push({
      latitude,
      longitude,
      date,
      time,
      observedAt: new Date(
        observationMs
      ).toISOString(),
      confidence:
        confidenceIndex >= 0
          ? values[confidenceIndex]?.trim() ?? null
          : null,
      frp,
      satellite,
    });
  }

  return detections;
}

// --------------------------------------------------
// EXISTING MAP SAMPLING
// --------------------------------------------------

function sampleDetections(matchingDetections) {
  const matchingCount = matchingDetections.length;

  const step = Math.max(
    1,
    Math.ceil(matchingCount / MAX_MAP_DETECTIONS)
  );

  const detections = [];

  for (let i = 0; i < matchingCount; i += step) {
    detections.push(matchingDetections[i]);

    if (detections.length >= MAX_MAP_DETECTIONS) {
      break;
    }
  }

  return {
    detections,
    matchingCount,
    returnedCount: detections.length,
    sampleOnly: matchingCount > detections.length,
  };
}

// --------------------------------------------------
// EXISTING WORLDWIDE GRID AGGREGATION
// --------------------------------------------------

function aggregateFireGrid(
  matchingDetections,
  gridDegrees = SUMMARY_GRID_DEGREES
) {
  const cells = new Map();

  for (const spot of matchingDetections) {
    const safeLatitude = Math.min(
      89.999999,
      Math.max(-90, spot.latitude)
    );

    const safeLongitude = Math.min(
      179.999999,
      Math.max(-180, spot.longitude)
    );

    const south =
      Math.floor(
        (safeLatitude + 90) / gridDegrees
      ) * gridDegrees - 90;

    const west =
      Math.floor(
        (safeLongitude + 180) / gridDegrees
      ) * gridDegrees - 180;

    const north = Math.min(
      90,
      south + gridDegrees
    );

    const east = Math.min(
      180,
      west + gridDegrees
    );

    const key = `${south},${west}`;

    if (!cells.has(key)) {
      cells.set(key, {
        latitude: (south + north) / 2,
        longitude: (west + east) / 2,
        south,
        west,
        north,
        east,
        count: 0,
        highestFRP: null,
      });
    }

    const cell = cells.get(key);
    cell.count += 1;

    if (
      spot.frp !== null &&
      Number.isFinite(spot.frp)
    ) {
      if (
        cell.highestFRP === null ||
        spot.frp > cell.highestFRP
      ) {
        cell.highestFRP = spot.frp;
      }
    }
  }

  const gridCells = Array.from(cells.values());

  gridCells.sort((a, b) => b.count - a.count);

  const aggregatedCount = gridCells.reduce(
    (total, cell) => total + cell.count,
    0
  );

  return {
    gridCells,
    gridCellCount: gridCells.length,
    aggregatedCount,
    gridDegrees,
  };
}

// --------------------------------------------------
// CACHE HELPERS
// --------------------------------------------------

function getCache() {
  return typeof caches !== "undefined"
    ? caches.default
    : null;
}

// Canonical cache keys ensure the same tile and
// observation selection share a cache entry.
//
// A 15-minute time bucket preserves the existing
// FireWatch refresh behavior.

function createCacheKey(
  request,
  endpoint,
  options,
  geographicArea,
  tile
) {
  const nowMs = Date.now();

  const bucket = Math.floor(
    nowMs / (CACHE_SECONDS * 1000)
  );

  const cacheUrl = new URL(request.url);

  cacheUrl.pathname = endpoint;

  cacheUrl.search = "";

  cacheUrl.searchParams.set(
    "satellite",
    options.satellite
  );

  cacheUrl.searchParams.set(
    "mode",
    options.mode
  );

  cacheUrl.searchParams.set(
    "days",
    String(options.days)
  );

  if (tile) {
    cacheUrl.searchParams.set(
      "x",
      String(tile.x)
    );

    cacheUrl.searchParams.set(
      "y",
      String(tile.y)
    );
  } else if (geographicArea.bounds) {
    cacheUrl.searchParams.set(
      "bbox",
      geographicArea.area
    );
  }

  cacheUrl.searchParams.set(
    "_bucket",
    String(bucket)
  );

  cacheUrl.searchParams.sort();

  return new Request(cacheUrl.toString());
}

async function readCache(cacheKey) {
  const cache = getCache();

  if (!cache) return null;

  try {
    const cached = await cache.match(cacheKey);

    if (!cached) return null;

    const headers = new Headers(cached.headers);

    headers.set("X-FireWatch-Cache", "HIT");

    return new Response(cached.body, {
      status: cached.status,
      headers,
    });
  } catch (error) {
    console.warn("Cache lookup unavailable:", error);
    return null;
  }
}

function storeCache(cacheKey, response, ctx) {
  const cache = getCache();

  if (!cache || !ctx?.waitUntil) return;

  ctx.waitUntil(
    cache.put(cacheKey, response.clone()).catch(
      (error) => {
        console.warn(
          "Cache storage unavailable:",
          error
        );
      }
    )
  );
}

// --------------------------------------------------
// NASA DATA RETRIEVAL
// --------------------------------------------------

async function fetchNASAData(
  env,
  satellite,
  area,
  nasaDays
) {
  const nasaUrl =
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/" +
    `${encodeURIComponent(env.FIRMS_MAP_KEY)}/` +
    `${SATELLITES[satellite]}/` +
    `${area}/${nasaDays}`;

  const response = await fetch(nasaUrl);

  if (!response.ok) {
    throw new Error(
      `NASA FIRMS request failed (${response.status})`
    );
  }

  const csv = await response.text();

  const firstLine = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)[0]
    .trim();

  if (
    !firstLine.includes("latitude") ||
    !firstLine.includes("longitude")
  ) {
    throw new Error("Unexpected NASA response");
  }

  return csv;
}

// --------------------------------------------------
// SHARED MAP / SUMMARY / TILE HANDLER
// --------------------------------------------------

async function handleFireRequest(
  request,
  env,
  ctx,
  endpoint
) {
  const url = new URL(request.url);

  let options;
  let geographicArea;
  let tile = null;

  try {
    options = getRequestOptions(url);

    if (endpoint === "tile") {
      tile = parseTile(url);

      geographicArea = {
        area: tile.area,
        bounds: tile.bounds,
      };
    } else {
      geographicArea = parseBoundingBox(
        url.searchParams.get("bbox")
      );
    }
  } catch (error) {
    return jsonResponse(
      { error: error.message },
      400
    );
  }

  if (!env.FIRMS_MAP_KEY) {
    return jsonResponse(
      {
        error: "NASA FIRMS API key is not configured",
      },
      503
    );
  }

  const endpointPath =
    endpoint === "tile"
      ? "/api/fire-tile"
      : endpoint === "summary"
        ? "/api/fire-summary"
        : "/api/fire-map";

  const cacheKey = createCacheKey(
    request,
    endpointPath,
    options,
    geographicArea,
    tile
  );

  const cached = await readCache(cacheKey);

  if (cached) {
    return cached;
  }

  const initialWindow = getObservationWindow(
    options.mode,
    options.days,
    Date.now()
  );

  try {
    const csv = await fetchNASAData(
      env,
      options.satellite,
      geographicArea.area,
      initialWindow.nasaDays
    );

    const checkedMs = Date.now();

    const window = getObservationWindow(
      options.mode,
      options.days,
      checkedMs
    );

    let matchingDetections = parseFireCSV(
      csv,
      options.satellite,
      window.windowStartMs,
      window.windowEndMs
    );

    // NASA bounding boxes may include observations
    // lying exactly on their borders.
    //
    // Assign border observations to exactly one
    // geographic tile to prevent duplication.
    if (tile) {
      matchingDetections =
        matchingDetections.filter(
          (spot) => belongsToTile(spot, tile)
        );
    }

    const matchingCount =
      matchingDetections.length;

    const sharedData = {
      isDemo: false,
      satellite: options.satellite,
      mode: options.mode,
      days: options.days,
      windowType: window.windowType,
      windowHours: window.windowHours,
      windowStart: new Date(
        window.windowStartMs
      ).toISOString(),
      windowEnd: new Date(
        window.windowEndMs
      ).toISOString(),
      area: geographicArea.bounds
        ? "regional"
        : "world",
      bounds: geographicArea.bounds,
      matchingCount,
      checkedAt: new Date(
        checkedMs
      ).toISOString(),
      isNearRealTime: true,
    };

    let responseData;

    // ----------------------------------------------
    // NEW: UNSAMPLED GEOGRAPHIC TILE
    // ----------------------------------------------

    if (endpoint === "tile") {
      responseData = {
        ...sharedData,

        tile: {
          id: tile.id,
          x: tile.x,
          y: tile.y,
          degrees: TILE_DEGREES,
          bounds: tile.bounds,
        },

        returnedCount: matchingCount,

        // No application-level sampling.
        sampleOnly: false,

        // This means every qualifying record
        // returned by NASA for this tile is included.
        allMatchingObservationsReturned: true,

        detections: matchingDetections,
      };
    }

    // ----------------------------------------------
    // EXISTING: WORLDWIDE GEOGRAPHIC SUMMARY
    // ----------------------------------------------

    else if (endpoint === "summary") {
      const summary = aggregateFireGrid(
        matchingDetections
      );

      responseData = {
        ...sharedData,
        summaryType: "geographic_grid",
        gridDegrees: summary.gridDegrees,
        gridCellCount: summary.gridCellCount,
        aggregatedCount: summary.aggregatedCount,
        allMatchingObservationsCounted:
          summary.aggregatedCount === matchingCount,
        sampleOnly: false,
        gridCells: summary.gridCells,
      };
    }

    // ----------------------------------------------
    // EXISTING: SAMPLED INDIVIDUAL MAP DETECTIONS
    // ----------------------------------------------

    else {
      const mapData = sampleDetections(
        matchingDetections
      );

      responseData = {
        ...sharedData,
        returnedCount: mapData.returnedCount,
        sampleOnly: mapData.sampleOnly,
        detections: mapData.detections,
      };
    }

    const response = jsonResponse(
      responseData,
      200,
      {
        "Cache-Control":
          `public, max-age=${CACHE_SECONDS}`,
        "X-FireWatch-Cache": "MISS",
      }
    );

    storeCache(cacheKey, response, ctx);

    return response;
  } catch (error) {
    console.error(
      "FireWatch NASA request error:",
      error
    );

    return jsonResponse(
      {
        error:
          endpoint === "tile"
            ? "Unable to retrieve NASA tile data"
            : endpoint === "summary"
              ? "Unable to retrieve NASA summary data"
              : "Unable to retrieve NASA map data",
      },
      502
    );
  }
}

// --------------------------------------------------
// MAIN WORKER ROUTER
// --------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        { error: "Method not allowed" },
        405
      );
    }

   // ----------------------------------------------
// HISTORICAL CALENDAR DATA
// ----------------------------------------------
// The historical calendar is currently served by
// the Vite frontend as a static JSON dataset:
//
// /data/firewatch_daily.json
//
// Do not return demonstration counts here.

if (url.pathname === "/api/calendar") {
  return jsonResponse(
    {
      error: "Historical calendar data is served by the frontend.",
      dataPath: "/data/firewatch_daily.json",
      isDemo: false,
    },
    410
  );
}

    // ----------------------------------------------
    // EXISTING RAW NASA CSV TEST ENDPOINT
    // ----------------------------------------------

    if (url.pathname === "/api/fires") {
      let options;

      try {
        const satellite =
          url.searchParams.get("satellite") ||
          "NOAA20";

        const days = Number(
          url.searchParams.get("days") || "1"
        );

        if (!Object.hasOwn(SATELLITES, satellite)) {
          throw new Error(
            "Invalid satellite selection"
          );
        }

        if (![1, 2, 3].includes(days)) {
          throw new Error(
            "Days must be 1, 2, or 3"
          );
        }

        options = { satellite, days };
      } catch (error) {
        return jsonResponse(
          { error: error.message },
          400
        );
      }

      if (!env.FIRMS_MAP_KEY) {
        return jsonResponse(
          {
            error:
              "NASA FIRMS API key is not configured",
          },
          503
        );
      }

      try {
        const csv = await fetchNASAData(
          env,
          options.satellite,
          "world",
          options.days
        );

        return new Response(csv, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type":
              "text/csv; charset=utf-8",
            "Cache-Control":
              "public, max-age=900",
          },
        });
      } catch (error) {
        console.error(
          "Raw NASA CSV request failed:",
          error
        );

        return jsonResponse(
          {
            error: "Unable to reach NASA FIRMS",
          },
          502
        );
      }
    }

    // ----------------------------------------------
    // EXISTING MAP ENDPOINT
    // ----------------------------------------------

    if (url.pathname === "/api/fire-map") {
      return handleFireRequest(
        request,
        env,
        ctx,
        "map"
      );
    }

    // ----------------------------------------------
    // EXISTING GEOGRAPHIC SUMMARY ENDPOINT
    // ----------------------------------------------

    if (url.pathname === "/api/fire-summary") {
      return handleFireRequest(
        request,
        env,
        ctx,
        "summary"
      );
    }

    // ----------------------------------------------
    // NEW: GEOGRAPHIC TILE ENDPOINT
    // ----------------------------------------------

    if (url.pathname === "/api/fire-tile") {
      return handleFireRequest(
        request,
        env,
        ctx,
        "tile"
      );
    }

    return jsonResponse(
      { error: "Not found" },
      404
    );
  },
};