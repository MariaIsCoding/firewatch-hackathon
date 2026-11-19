
<div align="center">

# 🔥 FIREWATCH
### Wildfire Intelligence, Powered by Satellite Data

**Turning satellite observations into accessible wildfire awareness.**

Built for the **[2026 NASA Space Apps Challenge](https://www.spaceappschallenge.org/2026/challenges/)** 🚀

[![Live Demo](https://img.shields.io/badge/🔥_LIVE_DEMO-Launch_FireWatch-F97316?style=for-the-badge)](https://firewatch-frontend-5z5.pages.dev/)
[![NASA Space Apps](https://img.shields.io/badge/NASA-Space_Apps_2026-0B3D91?style=for-the-badge)](https://www.spaceappschallenge.org/2026/challenges/)

**[🌐 Explore FireWatch](https://firewatch-frontend-5z5.pages.dev/)**

</div>

---

## 🌎 The Mission

Wildfires can spread rapidly, threatening communities, ecosystems, and infrastructure.

Satellite technology provides valuable observations of fire activity across the globe, but this information isn't always easy for everyday users to explore.

**FireWatch aims to bridge that gap.**

Created for the 2026 NASA Space Apps Challenge, FireWatch makes satellite-derived wildfire information more accessible through an interactive web application.

Our goal is simple:

> Make wildfire awareness more accessible, understandable, and actionable.

---

## ✨ Features

### 🛰️ Satellite-Based Fire Monitoring
Explore fire activity using satellite-derived observations and geospatial information.

### 🗺️ Interactive Wildfire Map
Visualize fire detections geographically through an interactive interface.

### 📍 Location-Based Monitoring
Choose an area of interest and explore wildfire activity relevant to that location.

### 📲 SMS Wildfire Alerts — Under Development
FireWatch is being developed to support location-based SMS wildfire notifications using **Twilio**.

The planned alert system will allow users to:
- Register a phone number to receive notifications.
- Select a geographic monitoring location.
- Choose an alert radius.
- Receive SMS notifications when relevant wildfire activity is detected.

**⚠️ Development Note:** The Twilio SMS alert functionality is not yet operational. While the alert registration interface has been implemented, successful automated SMS delivery has not yet been achieved.

---

## 📸 Application Preview


**🔥 [Try the Live Application](https://firewatch-frontend-5z5.pages.dev/)**

---

## ⚙️ How FireWatch Works

```mermaid
flowchart TD
    A["🛰️ Satellite Fire Observations"]
    B["📊 Data Processing"]
    C["🌐 FireWatch Application"]
    D["🗺️ Interactive Map"]
    E["📍 Location Monitoring"]
    F["📲 Twilio SMS Alerts - In Development"]

    A --> B
    B --> C
    C --> D
    C --> E
    E -.-> F
```

FireWatch transforms geospatial fire observations into information that users can explore through a web interface.

The dashed connection represents the planned Twilio SMS notification functionality, which is still under development.

---

## 🛠️ Technology Stack

Our application combines web development, geospatial data, and cloud-based services.

| Component | Technology |
|---|---|
| Hosting | Cloudflare Pages |
| Satellite observations | VIIRS |
| Frontend | To be confirmed |
| Backend | Cloudflare Pages Functions |
| Database | Cloudflare D1 |
| Mapping | To be confirmed |
| SMS Notifications | Twilio (In Development) |

---

## 🚀 Future Development

We hope to continue improving FireWatch by exploring:

- Completing and testing Twilio SMS wildfire notifications
- More timely wildfire data updates
- Improved location-based alert monitoring
- Additional satellite datasets
- Better map filtering and visualization
- Expanded geographic coverage
- Improved mobile accessibility

---

## 👩‍💻 Meet the Team

Developed by **Maria & Roberta** for the **2026 NASA Space Apps Challenge**.

This project brought together our interests in technology, real-world problem-solving, and building applications that can make a meaningful difference.

---

<div align="center">

### 🌍 Stay Aware. Stay Informed.

**Explore wildfire activity with FireWatch.**

[🔥 Launch FireWatch](https://firewatch-frontend-5z5.pages.dev/)

*Made with curiosity, collaboration, and a passion for technology.*

</div>
