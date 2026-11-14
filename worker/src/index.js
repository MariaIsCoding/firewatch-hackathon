
const SATELLITES = {
  MODIS: "MODIS_NRT",
  NOAA20: "VIIRS_NOAA20_NRT",
  NOAA21: "VIIRS_NOAA21_NRT",
};

const MAX_MAP_DETECTIONS = 5000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Preserve the existing demonstration calendar endpoint.
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

    // Return the original NASA FIRMS CSV for testing.
    if (url.pathname === "/api/fires") {
      const satellite = url.searchParams.get("satellite") || "NOAA20";
      const days = Number(url.searchParams.get("days") || "1");

      if (!Object.hasOwn(SATELLITES, satellite)) {
        return Response.json(
          { error: "Invalid satellite selection" },
          { status: 400 }
        );
      }

      if (![1, 2, 3].includes(days)) {
        return Response.json(
          { error: "Days must be 1, 2, or 3" },
          { status: 400 }
        );
      }

      if (!env.FIRMS_MAP_KEY) {
        return Response.json(
          { error: "NASA FIRMS API key is not configured" },
          { status: 503 }
        );
      }

      const source = SATELLITES[satellite];

      const nasaUrl =
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/" +
        `${encodeURIComponent(env.FIRMS_MAP_KEY)}/` +
        `${source}/world/${days}`;

      try {
        const nasaResponse = await fetch(nasaUrl);

        if (!nasaResponse.ok) {
          return Response.json(
            { error: "NASA FIRMS request failed" },
            { status: 502 }
          );
        }

        // Stream the original CSV without parsing it.
        return new Response(nasaResponse.body, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Cache-Control": "public, max-age=900",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error) {
        return Response.json(
          { error: "Unable to reach NASA FIRMS" },
          { status: 502 }
        );
      }
    }

    // Return geographically distributed NASA detections
    // in JSON format for the interactive FireWatch map.
    if (url.pathname === "/api/fire-map") {
      const satellite = url.searchParams.get("satellite") || "NOAA20";
      const days = Number(url.searchParams.get("days") || "1");

      if (!Object.hasOwn(SATELLITES, satellite)) {
        return Response.json(
          { error: "Invalid satellite selection" },
          { status: 400 }
        );
      }

      if (![1, 2, 3].includes(days)) {
        return Response.json(
          { error: "Days must be 1, 2, or 3" },
          { status: 400 }
        );
      }

      if (!env.FIRMS_MAP_KEY) {
        return Response.json(
          { error: "NASA FIRMS API key is not configured" },
          { status: 503 }
        );
      }

      const source = SATELLITES[satellite];

      const nasaUrl =
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/" +
        `${encodeURIComponent(env.FIRMS_MAP_KEY)}/` +
        `${source}/world/${days}`;

      try {
        const nasaResponse = await fetch(nasaUrl);

        if (!nasaResponse.ok) {
          return Response.json(
            { error: "NASA FIRMS request failed" },
            { status: 502 }
          );
        }

        const csv = await nasaResponse.text();
        const lines = csv.trim().split(/\r?\n/);

        if (lines.length < 2) {
          return Response.json(
            {
              isDemo: false,
              satellite,
              days,
              returnedCount: 0,
              sampleOnly: false,
              detections: [],
            },
            {
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=900",
              },
            }
          );
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
          return Response.json(
            { error: "Unexpected NASA data format" },
            { status: 502 }
          );
        }

        const detections = [];

        // Spread observations throughout the NASA response
        // instead of taking only the first 500 records.
        const totalRows = lines.length - 1;
        const step = Math.max(
          1,
          Math.ceil(totalRows / MAX_MAP_DETECTIONS)
        );

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

          const frpValue =
            frpIndex >= 0 ? values[frpIndex] : null;

          const frp =
            frpValue != null &&
            frpValue.trim() !== "" &&
            Number.isFinite(Number(frpValue))
              ? Number(frpValue)
              : null;

          detections.push({
            latitude,
            longitude,
            date:
              dateIndex >= 0 ? values[dateIndex] : null,
            time:
              timeIndex >= 0 ? values[timeIndex] : null,
            confidence:
              confidenceIndex >= 0
                ? values[confidenceIndex]
                : null,
            frp,
            satellite,
          });

          if (detections.length >= MAX_MAP_DETECTIONS) {
            break;
          }
        }

        return Response.json(
          {
            isDemo: false,
            satellite,
            days,
            returnedCount: detections.length,
            sampleOnly: totalRows > detections.length,
            detections,
          },
          {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=900",
            },
          }
        );
      } catch (error) {
        return Response.json(
          { error: "Unable to retrieve NASA map data" },
          { status: 502 }
        );
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
