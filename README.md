# Ride Along — Standalone

A portable mobile-first web app/PWA. No Replit account or proprietary backend is required.

## Run
Serve this folder with any static web server. GPS and service workers generally require HTTPS (or localhost). Opening index.html directly will show the interface, but browsers may block GPS/offline service-worker behavior from file:// URLs.

## Implemented
- Plan / My Trip / Discover / Nearby
- 30-minute durations from 30 minutes through 12 hours
- flexible endpoints, including custom hotel/destination
- feasibility checks and approximate road-time estimates clearly labeled as estimates
- editable/reorderable/persistent itinerary and progress
- Google Maps handoff
- 40+ curated northern Arizona records with source attribution
- GPS nearby sorting and foreground story triggers with repeat suppression
- browser narration play/pause/replay and speed
- local favorites/preferences/trips
- PWA-style offline cache, check, update and remove controls

## Important limitations
- Drive estimates are planning approximations, not live traffic or a paid routing API.
- Custom addresses cannot be geocoded offline, so their final-leg estimate uses a conservative placeholder until a routing/geocoding service is added.
- GPS stories run while the page/app remains active; background behavior is browser/OS dependent.
- SpeechSynthesis voices vary by device and may not work offline.
- Google Maps is external and has its own connectivity/offline requirements.
- Real-device airplane-mode, GPS, audio interruption and Maps-switch tests are still required.

## Privacy
Core state is stored locally in the browser. No API keys are included.