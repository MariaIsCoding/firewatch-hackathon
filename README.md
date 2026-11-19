# FireWatch — Backend Development

This branch contains my backend contributions to **FireWatch**, a wildfire monitoring application developed for the 2026 NASA Space Apps Challenge.

My work focused on building the Cloudflare backend infrastructure, integrating NASA FIRMS satellite data, managing SMS subscriptions, and developing a location-based wildfire notification system using Twilio.

## Technologies Used

- **JavaScript** — Backend logic and API development
- **Cloudflare Workers** — Serverless backend processing
- **Cloudflare Pages Functions** — SMS subscription API
- **Cloudflare D1** — Database for subscriptions and alerts
- **NASA FIRMS API** — Satellite fire detection data
- **Twilio API** — SMS notification integration
- **SQL** — Database tables and migrations
- **Wrangler** — Cloudflare configuration and development

## Backend Features

### NASA FIRMS Integration
- Implemented backend requests for satellite fire observation data.
- Supported processing of VIIRS and MODIS fire detections.
- Used geographic coordinates to identify relevant wildfire observations.

### Location-Based Wildfire Monitoring
- Implemented the Haversine formula to calculate distances between satellite detections and registered monitoring locations.
- Supported monitoring radii of 5, 10, 25, and 50 kilometers.
- Developed logic to identify detections within a user's selected monitoring area.

### SMS Subscription Management
- Created a Cloudflare Pages Function to process SMS subscription requests.
- Used Cloudflare D1 to store phone numbers, monitoring locations, selected radii, and consent timestamps.
- Implemented input validation, duplicate subscription checks, and basic signup limits.

### Twilio SMS Integration
- Developed backend logic for sending wildfire notifications through the Twilio API.
- Implemented alert tracking and cooldown mechanisms to reduce duplicate notifications.
- Added local testing and dry-run functionality.

**Note:** Automated SMS notifications are still under development. The backend integration has been implemented, but successful end-to-end SMS delivery has not yet been established.

## Project Structure

```text
firewatch-hackathon/
├── frontend/
│   └── functions/
│       └── api/
│           └── sms-subscriptions.js
│
└── worker/
    ├── migrations/
    │   ├── 0001_sms_alerts.sql
    │   └── 0002_firms_sms_cooldown.sql
    ├── src/
    │   └── index.js
    ├── .gitignore
    └── wrangler.jsonc
```

## Security Considerations

The backend incorporates several security measures, including:

- Environment variables for sensitive API credentials
- Parameterized SQL queries
- Input validation and consent verification
- Duplicate subscription prevention
- Basic signup limits and SMS cooldown logic
- Exclusion of local credential files through `.gitignore`

Additional security measures, including phone-number verification and stronger abuse prevention, are needed before enabling production SMS notifications.

## Future Improvements

- Complete and test automated Twilio SMS delivery
- Improve subscription security and phone-number verification
- Expand automated testing of wildfire notification workflows
- Improve scheduled satellite data processing

---

**Developer:** Maria  
**Project:** FireWatch — NASA Space Apps Challenge 2026

For the complete project overview, application screenshots, and live demo, see the README on the `main` branch.
