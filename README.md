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

Mediapp reads `SONARR_URL`, `SONARR_API_KEY`, `RADARR_URL`, `RADARR_API_KEY`, `PORT`, `HOST`, and `BASE_PATH` from `.env` (existing process environment variables take precedence). A service can be left unconfigured; the other card continues to work. Find API keys in the Security settings of the corresponding Sonarr or Radarr instance. The server binds to localhost by default.

## API-key handling

API keys are read only by the Node.js server and sent to the configured service in the `X-Api-Key` request header. They are never placed in browser code, returned by Mediapp's dashboard endpoint, written to logs, or accepted from browser input. For container deployments, set `SONARR_API_KEY_FILE` and/or `RADARR_API_KEY_FILE` to mounted, read-only secret file paths; these take precedence over the corresponding key environment variable. Keep `.env` private; it is excluded from Git. Use a trusted network or put Mediapp behind your usual authenticated reverse proxy before exposing it beyond your local network.

The configured Sonarr/Radarr URLs are trusted server-side destinations. Only configure URLs for services you control.

## Reverse proxy / Davelight

Mediapp can be mounted below a path prefix when sharing a web server. Set `BASE_PATH` to the public path (for example, `/mediapp`) and configure the reverse proxy to forward that same path prefix **without stripping it**. The Mediapp process must receive requests like `/mediapp/` and `/mediapp/api/dashboard`; its generated asset, API, and favicon URLs will then stay under the prefix. `BASE_PATH` defaults to empty for a root-mounted standalone app.

For a Davelight Docker Compose deployment, build the image from this repository's `Dockerfile`, set `BASE_PATH=/mediapp`, and have Davelight's Nginx proxy `/mediapp/` to Mediapp's internal service name while preserving the URI. Mediapp listens on `0.0.0.0:3000` inside its container; do not publish that port to the host when it is only accessed through the existing Nginx ingress. Mount API key files read-only and set the matching `*_API_KEY_FILE` variables. Keep Davelight's existing ports and routes unchanged.

## What the dashboard reports

- **Status and health:** Sonarr/Radarr system status and health endpoints.
- **Queue and progress:** Queue records, progress, and estimated remaining details reported by Sonarr/Radarr.
- **Recent activity:** The most recent history records provided by Sonarr/Radarr.

Mediapp does not connect directly to a download client. Queue state is what Sonarr/Radarr report about their tracked downloads; client-specific details not exposed through those APIs (such as a complete client queue or client controls) are not shown.

Service icons are the official Sonarr and Radarr brand marks from their respective repositories.

The dashboard refreshes every 30 seconds and also has a manual refresh button. Mediapp makes read-only API requests.

## Development

```sh
npm test
npm start
```
