export default {
  fetch(request) {
    const url = new URL(request.url);

    if (request.method !== "GET" || url.pathname !== "/api/calendar") {
      return new Response("Not found", { status: 404 });
    }

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
  },
};
