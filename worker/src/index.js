export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/api/calendar") {
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

    if (request.method !== "POST" || pathname !== "/api/demo-alert") {
      return new Response("Not found", { status: 404 });
    }

    if (!env.DEMO_ALERT_TOKEN || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      return Response.json({ error: "Demo alert is not configured." }, { status: 503 });
    }

    const authorization = request.headers.get("Authorization");
    if (authorization !== `Bearer ${env.DEMO_ALERT_TOKEN}`) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = new URLSearchParams({
      From: "+19522588229",
      To: "+17079000715",
      Body: "FireWatch demo: This is a test alert from the web app.",
    });

    try {
      const credentials = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${credentials}` },
          body,
        },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return Response.json(
          { error: "Twilio rejected the test alert.", twilioCode: error.code ?? null },
          { status: 502 },
        );
      }

      const message = await response.json();
      return Response.json(
        { messageSid: message.sid, status: message.status },
        { status: 202 },
      );
    } catch {
      return Response.json({ error: "Could not confirm the send with Twilio." }, { status: 502 });
    }
  },
};
