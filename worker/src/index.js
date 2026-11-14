
const SATELLITES = {
  MODIS: "MODIS_NRT",
  NOAA20: "VIIRS_NOAA20_NRT",
  NOAA21: "VIIRS_NOAA21_NRT",
};

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

    // New NASA FIRMS fire detection endpoint.
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
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/` +
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

        // Return CSV directly for this first integration test.
        return new Response(csv, {
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

    return new Response("Not found", { status: 404 });
  },
};
