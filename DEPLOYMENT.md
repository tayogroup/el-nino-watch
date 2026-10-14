# Deploy El Nino Watch

This package is a complete Node application, with its frontend, server modules, maps, English/Somali catalog, library assets and notices. No npm runtime dependencies, compilation step or API keys are required for the existing features. Use Node.js 24 LTS (Node 22 or newer is supported). Release snapshot: 2026-10-14, East Africa date.

## Local use / another development environment

Extract the ZIP into a new folder. Open a terminal in the folder containing package.json.

    npm start

Open http://127.0.0.1:4173. Ctrl+C stops the server. You can also run `node work/somalia-flood-watch/server.mjs`, `Start-Live-App.ps1` on Windows, or `sh start.sh` on Linux/macOS. Install Node separately; this archive does not contain an operating-system-specific Node binary.

`.env.example` documents the available variables; it is not loaded by npm start automatically. Supply them in your hosting dashboard/shell, or copy it to .env and run:

    node --env-file=.env work/somalia-flood-watch/server.mjs

## Node-compatible hosting

Deploy this entire package at the domain root. Set the start command to `npm start`; no build command is needed. Set HOST=0.0.0.0. Use the PORT supplied by the hosting platform, or 4173 behind your own reverse proxy. Set COMMUNITY_DATA_DIR to an absolute, writable persistent directory outside the public dist folder. Use one Node process/replica per data directory: this version keeps JSON records in memory and is not a shared-database cluster.

Use the platform's HTTPS/domain configuration. For your own HTTPS reverse proxy, preserve the original public Host header. Community writes compare the request Origin host with Host; a proxy that replaces Host with localhost can reject valid uploads and comments. The sample deploy/nginx-location.conf belongs inside an already configured HTTPS virtual host; it contains no TLS certificate or domain setup. Allow request bodies of at least 52 MiB and outbound HTTPS to the source providers. The server's submission limiter sees the proxy connection address; use host/edge rate controls when exposing the service publicly.

Use / as the health-check path. An unavailable upstream feed is labelled by the app and does not make the static page unavailable. Invalid community storage returns 503 for that service while the other page routes remain available.

Static-only hosts can serve the frontend, but cannot run reports/uploads/comments or the server data relays. The full app requires Node hosting or the Docker option below. This package does not configure hosting accounts, DNS or deploy anything automatically.

## Docker

    docker compose up --build -d

Open http://127.0.0.1:4173. Compose uses a named volume for report data and a single non-root Node container. To choose a different external port, set PORT before the command. The container's internal port remains 4173. The first image build requires internet access to obtain the official Node image. Docker configuration is included; validate it on your Docker host before publication.

The container starts as root only to hand the report directory to the `node` user (`docker-entrypoint.mjs`), then runs the server as `node`. Hosts that mount a blank volume owned by root would otherwise leave community writes failing with 503.

## Live hosting: Bunny Magic Containers (elninowatch.so)

Every push to `main` runs `.github/workflows/deploy.yml`: `npm run check` and `npm test`, then a linux/amd64 image is published as `ghcr.io/tayogroup/el-nino-watch:<commit>` and `:latest`, then (once configured) the Bunny app is rolled to that commit.

One-time setup in the bunny.net dashboard, Magic Containers, **+ Add App**:

- Image: `ghcr.io/tayogroup/el-nino-watch`, tag `latest`. The container is named after the image (`el-nino-watch`).
- Endpoint: **CDN**, container port `4173`.
- Persistent volume: mount path `/app/data`, 5 GB to start (it can grow, never shrink).
- Region: Frankfurt. **Exactly one instance in one region, autoscaling and autoprovisioning off.** Each pod gets its own blank volume, so a second instance would hold a different set of reports.
- No environment variables are needed; the image sets HOST, PORT and COMMUNITY_DATA_DIR.

Then, for automatic rollouts, add in GitHub (Settings > Secrets and variables > Actions) the variable `BUNNY_APP_ID` and the secret `BUNNYNET_API_KEY` (the main account API key; sub-user keys are not supported).

Domain, registered at Namecheap: add `elninowatch.so` and `www.elninowatch.so` as hostnames on the app's CDN endpoint pull zone, and in Namecheap Advanced DNS point `www` (CNAME) and the apex `@` (ALIAS) at the pull zone's `*.b-cdn.net` hostname. Enable SSL for both hostnames in Bunny once DNS resolves. Community writes compare the Origin with the Host header, so the pull zone must forward the visitor's Host to the container; if posting a report returns 403 "Community writes must come from this app", enable **Forward Host Header** on the pull zone.

### Backups of the reports volume

Bunny volumes have no backups of their own, so the server makes them (`work/somalia-flood-watch/backup.mjs`). When `BACKUP_STORAGE_ZONE` and `BACKUP_STORAGE_KEY` are set it copies the reports to a Bunny Storage zone:

- **A snapshot of `reports.json`** in `el-nino-watch/snapshots/<time>/`, every 6 hours (`BACKUP_INTERVAL_HOURS`), only when the reports changed since the last one. The first run is a minute after start.
- **Photos and videos** in `el-nino-watch/media/`, uploading only files the backup does not already hold.
- **Retention:** snapshots older than 14 days (`BACKUP_RETENTION_DAYS`) are deleted, but the newest three are always kept; media that no kept snapshot refers to is then deleted too. A report its author deletes is therefore gone from the backups within 14 days.
- **Restore:** when the server starts and `reports.json` does not exist (a new or lost volume), it restores the newest snapshot and its media first. Set `BACKUP_RESTORE_IF_EMPTY=false` to start empty instead. If the storage cannot be reached after three tries the app starts empty and logs it; the snapshots stay in storage.
- **Status:** `GET /api/backup-status` reports whether backups are on and the last attempt, success, result and error. It never includes the zone name or key. Successes and failures are also in the app's logs.

Setup: create a Storage zone (Delivery > Storage > Add Storage Zone, e.g. `el-nino-watch-backups`, Standard tier, main region Falkenstein) and **do not connect a pull zone to it**; the reports and photos must not be publicly reachable. Then in the Magic Containers app, Container settings > Environment variables, add `BACKUP_STORAGE_ZONE` (the zone name) and `BACKUP_STORAGE_KEY` (the zone's password from its FTP & API Access page). If the zone's main region is not Falkenstein, also set `BACKUP_STORAGE_ENDPOINT` to that region's storage endpoint, for example `https://uk.storage.bunnycdn.com`.

## Data and migration

The ZIP deliberately contains no existing reports, uploads, deletion receipt hashes, credentials, logs, .git state or local hosting identity. A fresh deployment starts with an empty report board. To move actual shared records separately, stop writes/the old server, back up its complete data directory (reports.json and media/ together), restore it on the new server, set COMMUNITY_DATA_DIR to that location, and give the Node process read/write access. Keep backups private and outside dist.

Language preferences, additional-city lists, Mayor actions, private notes and browser deletion receipts belong to each browser's local storage. They do not migrate with the code ZIP. Moving to a different origin can leave those records and receipt access in the old browser origin.

Live weather, warnings, river readings, satellite observations and external Earth/Street View links need internet access and remain subject to their providers' availability and terms. The bundled Natural Earth geography is offline reference context, not live satellite imagery. No current flood event data are fabricated or bundled as sample community reports.

## Verify the package

    npm run check

This checks the file manifest, byte counts and SHA-256 hashes. Run npm test for the included regression suite, npm run build:translations and npm run build:basemap to rebuild generated resources, and npm run bundle to regenerate the runtime folder and standalone HTML under outputs/. The work/ layout is retained so all test and fixture imports work.

Node support: https://nodejs.org/en/about/previous-releases
Full application behavior and source limitations: work/somalia-flood-watch/README.md
