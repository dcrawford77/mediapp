# Mediapp

Mediapp is a small, self-hosted dashboard for Sonarr and Radarr. It displays each service's connection status, version, health notices, current download queue, and recent history.

## Requirements

- Node.js 18 or newer
- Sonarr and/or Radarr reachable from the machine running Mediapp

## Run locally

1. Copy `.env.example` to `.env`.
2. Set each service's URL and API key. A URL should be the instance root, for example `http://192.168.1.20:8989`; do not include `/api/v3`.
3. Start Mediapp:

   ```sh
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000).

Mediapp reads `SONARR_URL`, `SONARR_API_KEY`, `RADARR_URL`, `RADARR_API_KEY`, and `PORT` from `.env` (existing process environment variables take precedence). A service can be left unconfigured; the other card continues to work. Find API keys in the Security settings of the corresponding Sonarr or Radarr instance. The server binds to localhost by default.

## API-key handling

API keys are read only by the Node.js server and sent to the configured service in the `X-Api-Key` request header. They are never placed in browser code, returned by Mediapp's dashboard endpoint, written to logs, or accepted from browser input. Keep `.env` private; it is excluded from Git. Use a trusted network or put Mediapp behind your usual authenticated reverse proxy before exposing it beyond your local network.

The configured Sonarr/Radarr URLs are trusted server-side destinations. Only configure URLs for services you control.

## What the dashboard reports

- **Status and health:** Sonarr/Radarr system status and health endpoints.
- **Queue and progress:** Queue records, progress, and estimated remaining details reported by Sonarr/Radarr.
- **Recent activity:** The most recent history records provided by Sonarr/Radarr.

Mediapp does not connect directly to a download client. Queue state is what Sonarr/Radarr report about their tracked downloads; client-specific details not exposed through those APIs (such as a complete client queue or client controls) are not shown.

The dashboard refreshes every 30 seconds and also has a manual refresh button. Mediapp makes read-only API requests.

## Development

```sh
npm test
npm start
```
