# FireWatch — NASA FIRMS API Integration

This branch contains an early implementation of the NASA FIRMS API integration for FireWatch, developed for the 2026 NASA Space Apps Challenge.

## Features

- Cloudflare Worker backend using JavaScript
- NASA FIRMS API integration
- Support for MODIS, VIIRS NOAA-20, and VIIRS NOAA-21
- Satellite selection and observation-period validation
- CSV responses containing satellite fire detections
- 15-minute response caching configuration
- Demonstration calendar endpoint

## API Endpoints

**GET `/api/fires`**

Retrieves satellite fire observation data from NASA FIRMS.

Example: `/api/fires?satellite=NOAA21&days=1`

**GET `/api/calendar`**

Returns demonstration calendar data.

## Configuration

The Worker uses the `FIRMS_MAP_KEY` environment variable to authenticate NASA FIRMS API requests.

API credentials should be configured through Cloudflare secrets and should not be committed to GitHub.

## Development Note

This branch is preserved as a record of the project's development process, documenting the initial NASA FIRMS API integration before the backend was expanded with additional functionality.

For the more developed backend implementation, including Cloudflare D1, geographic wildfire matching, and Twilio SMS integration, see the `feature/cloudflare-twilio-backend` branch.
