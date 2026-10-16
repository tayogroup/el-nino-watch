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

- **A snapshot of `reports.json`** in `el-nino-watch/snapshots/<time>/`, every 6 hours (`BACKUP_INTERVAL_HOURS`), only when the reports changed since the last one. The first run is a minute after start, and a report being added or deleted triggers a run within 5 minutes.
- **Visit counts** (`visits.json`, see below) as one latest copy, `el-nino-watch/visits.json`, restored on start if missing.
- **Photos and videos** in `el-nino-watch/media/`, uploading only files the backup does not already hold.
- **Retention:** snapshots older than 14 days (`BACKUP_RETENTION_DAYS`) are deleted, but the newest three are always kept; media that no kept snapshot refers to is then deleted too. A report its author deletes is therefore gone from the backups within 14 days.
- **Restore:** when the server starts and `reports.json` does not exist (a new or lost volume), it restores the newest snapshot and its media first. Set `BACKUP_RESTORE_IF_EMPTY=false` to start empty instead. If the storage cannot be reached after three tries the app starts empty and logs it; the snapshots stay in storage.
- **Status:** `GET /api/backup-status` reports whether backups are on and the last attempt, success, result and error. It never includes the zone name or key. Successes and failures are also in the app's logs.

### Visitor statistics

The server counts visits itself (`visits.mjs`): every page load is one visit, plus which tab and city were viewed, the language, phone or computer, and the country Bunny reports. No cookies, no third party, and no internet address or browser string is stored; browsers asking not to be tracked are not counted. The counts are published at `/stats` (and a footer link appears) only once the site has had 1,000 visits; until then `/stats` says so and shows only the all-time total as progress towards 1,000, and `/api/visits` returns that total and nothing else. The owner can see them earlier: run **Actions > Bunny settings** with mode `stats-key`, which sets a random `STATS_KEY` on the container (hidden in the public logs), read it in Bunny under Container settings > Environment variables, and enter it under **Owner access** on `/stats`. It is sent only in an `X-Stats-Key` header; 20 wrong attempts a day lock a connection out. Running `stats-key` again replaces the key.

Setup: create a Storage zone (Delivery > Storage > Add Storage Zone, e.g. `el-nino-watch-backups`, Standard tier, main region Falkenstein) and **do not connect a pull zone to it**; the reports and photos must not be publicly reachable. Then in the Magic Containers app, Container settings > Environment variables, add `BACKUP_STORAGE_ZONE` (the zone name) and `BACKUP_STORAGE_KEY` (the zone's password from its FTP & API Access page). If the zone's main region is not Falkenstein, also set `BACKUP_STORAGE_ENDPOINT` to that region's storage endpoint, for example `https://uk.storage.bunnycdn.com`.

### Data-source keys (Google Flood Hub, ReliefWeb)

Two optional sources need a key of their own, and each is switched off until it is set on the container:

- `GOOGLE_FLOOD_API_KEY`: Google Flood Hub river forecasts in Alerts. Join the waitlist at https://developers.google.com/flood-forecasting; once Google approves it, reply with a Google Cloud project ID, enable the Flood Forecasting API in that project and create an API key there (restrict it to that API).
- `RELIEFWEB_APPNAME`: ReliefWeb items in the news flash, an appname ReliefWeb has approved (https://apidoc.reliefweb.int/parameters#appname).

To set them, add each as a secret of the `bunny-settings` environment (GitHub: Settings > Environments > bunny-settings > Add environment secret), then run **Actions > Bunny settings** with mode `source-keys` and approve the run. It copies the ones that are set onto the container and prints their names only.

### WhatsApp alerts

People who sign up get a WhatsApp message when a MOEWR national flood level, an ICPAC heavy-rain forecast or a Google Flood Hub river level starts or gets worse for a city they follow, at most 3 a day (`work/somalia-flood-watch/whatsapp.mjs`). It is off until all five settings below are on the container; until then the Alerts tab shows no WhatsApp button.

How people sign up: the "Get alerts on WhatsApp" button on the Alerts tab opens WhatsApp with `JOIN <city>` (Somali `KU BIIR <city>`) ready to send to the El Nino Watch number. They can also type it. `LIST` shows their cities, `STOP <city>` drops one, `STOP` (`JOOJI`) stops everything and deletes their number. Up to 5 cities each.

Set it up (the owner):

1. Verify the business with Meta (Meta Business Suite, Security Center), for Mandek Consulting.
2. At https://developers.facebook.com create a Business app and add the WhatsApp product. Add a phone number that is not already on the WhatsApp or WhatsApp Business app, and get the display name "El Nino Watch" approved. Add a payment method in WhatsApp Manager.
3. In Business Settings create a system user and give it a permanent token with the `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
4. In WhatsApp Manager, create the message template `flood_alert`, category **Utility**, language **English**, with this body and the sample values shown:

   > El Nino Watch alert for {{1}}: {{2}}. Source: {{3}}. {{4}} Details: https://elninowatch.so Reply STOP to stop these alerts.

   Samples: {{1}} `Galkayo`, {{2}} `national flood watch`, {{3}} `Ministry of Energy and Water Resources (MOEWR)`, {{4}} `This is the official national flood forecast.`

   Then try adding a Somali version of the same template. Meta's language list may not include Somali; if it accepts one under some language code, put that code in `WHATSAPP_TEMPLATE_SO_LANGUAGE`. Without it, Somali subscribers get the English template (their replies are still in Somali).

   > Digniinta El Nino Watch ee {{1}}: {{2}}. Isha: {{3}}. {{4}} Faahfaahin: https://elninowatch.so Ku jawaab JOOJI si aad u joojiso digniinahan.

5. Add these as secrets of the `bunny-settings` environment (GitHub: Settings > Environments > bunny-settings), then run **Actions > Bunny settings** with mode `source-keys` and approve it:
   - `WHATSAPP_TOKEN`: the system user's token.
   - `WHATSAPP_APP_SECRET`: the app's secret (App settings > Basic). Every message Meta sends the site is checked against it.
   - `WHATSAPP_VERIFY_TOKEN`: any long random string you choose; it is entered again in step 6.
   - `WHATSAPP_PHONE_NUMBER_ID`: the number's ID (WhatsApp > API setup), not the number.
   - `WHATSAPP_NUMBER`: the number itself, in international form (e.g. 25261...). It is shown on the site's button.
   - optional `WHATSAPP_TEMPLATE_SO_LANGUAGE`, see step 4.
6. In the app, WhatsApp > Configuration: callback URL `https://elninowatch.so/api/whatsapp/webhook`, verify token as in step 5, and subscribe to the `messages` field.
7. Test: from a phone, send `JOIN Galkayo` to the number. A confirmation should come back within seconds.

How it behaves: the server checks the alerts every 15 minutes. The very first check only records the alerts already running, so switching it on sends nothing; after that a message goes out when an alert starts or gets worse, and a level that holds or falls sends nothing. MOEWR comes first when more than 3 are due in a day. Only MOEWR messages say "official"; ICPAC and Flood Hub messages say "This is not an official warning."

Costs: Meta charges for each alert delivered (utility template, "Rest of Africa" rate; see Meta's rate card). Replies to people's own messages within 24 hours are free.

Privacy: phone numbers, cities and language are kept in `whatsapp.json` on the reports volume, readable only by the server, and are deleted on STOP. They are not in the report backups, so a lost volume loses the subscriber list (people would sign up again). Logs show only the last 3 digits of a number.

Audio bulletin on WhatsApp (opt-in): sending `CODKA` (English `AUDIO`) asks for the Somali audio bulletin, with or without following a city; `JOOJI CODKA` (`STOP AUDIO`) stops it. Each new evening bulletin goes to them as the template `flood_bulletin` (category **Utility**), which needs creating like `flood_alert`:

   > El Nino Watch audio bulletin, in Somali: {{1}}. Listen: {{2}} Reply STOP AUDIO to stop the bulletin.

   Samples: {{1}} `Warbixinta fiidka, Jimce, 16 Oktoobar`, {{2}} `https://elninowatch.so/?lang=so#podcast`. Somali version, if Meta accepts one:

   > Warbixinta codka ee El Nino Watch: {{1}}. Dhageyso: {{2}} Ku jawaab JOOJI CODKA si aad u joojiso.

   Optional settings on the container: `WHATSAPP_BULLETIN_TEMPLATE` (another template name) and `WHATSAPP_BULLETIN_SLOTS` (default `evening`; `morning,midday,evening` for all three). Each bulletin message is charged like an alert.

### Audio bulletins (Somali and English, three times a day)

A short Somali bulletin at 06:30, 12:30 and 18:30 East Africa Time (`work/somalia-flood-watch/podcast.mjs`), written from the site's own feeds by a fixed template and voiced by Google Gemini (model `gemini-3.8-flash-tts`, voice Puck). The latest one plays first on the home page, under the header, with its text, when it was recorded and when the next is due; before the first recording the panel says when that will be. Bulletins are kept 7 days on the reports volume (`podcast/`); they are not in the backups.

It is off until all three of these hold:

1. The owner has approved the template: `APPROVED_TEMPLATE` in `podcast.mjs` equals `TEMPLATE_VERSION`. Changing the template's wording means a new version and a new approval.
2. `GEMINI_API_KEY` is set: create a key in Google AI Studio (https://aistudio.google.com/apikey) and add it as a secret of the `bunny-settings` environment.
3. `PODCAST_ENABLED` is `1`: add it as a secret of the same environment.

Then run **Actions > Bunny settings** with mode `source-keys` and approve it. Optional: `PODCAST_VOICE` (default `Puck`), `PODCAST_MODEL`.

Try the template without publishing anything: `node work/somalia-flood-watch/podcast.mjs --slot evening` prints the bulletin as it would be read now, from the live site's data (free). Add `--voice` to make an MP3 in `outputs/podcast/` (needs `GEMINI_API_KEY` in the environment or in the file named by `ENV_FILE`, and ffmpeg; it is billed).

Hold switch: to stop new bulletins at once, without a deploy, send `{"hold": true}` to `/api/podcast/hold` with the stats key; `{"hold": false}` resumes. For example, with the stats key in the shell variable `STATS_KEY`: `curl -X POST https://elninowatch.so/api/podcast/hold -H "X-Stats-Key: $STATS_KEY" -H "Content-Type: application/json" -d '{"hold": true}'`. Bulletins already made stay listenable.

English bulletins (owner, 2026-10-17): each slot is also voiced in English, from the same data and the same rules, approved by the owner on 2026-10-17 (`APPROVED_TEMPLATE_EN` in `podcast.mjs`; changing the English wording means a new `TEMPLATE_VERSION_EN` and a new approval). Before the first English bulletin of a slot exists, English readers hear the Somali one, marked "in Somali". Try it with `node work/somalia-flood-watch/podcast.mjs --slot evening --lang en` (add `--voice` for an MP3). With English on, the cost is about $6 a month at the 2026 price.

Podcast feeds: `https://elninowatch.so/podcast.xml` (Somali) and `https://elninowatch.so/podcast-en.xml` (English, once English is on) list the last 7 days of bulletins for podcast apps, with the covers `podcast-cover.jpg` and `podcast-cover-en.jpg` (1400 x 1400) and `contact@mandekconsulting.com` as the owner address the directories verify. To publish it: Spotify, at https://podcasters.spotify.com, choose "I already have a podcast" and paste the feed address; Apple, at https://podcastsconnect.apple.com, add a show "From an RSS feed". Both read the feed again by themselves, so new bulletins appear there without anything more to do. The site also announces the feed in its page head, so podcast apps that are given https://elninowatch.so find it.

Plays: the first play of each bulletin in a page is counted, anonymously and by slot, with the visit counts; the private stats view shows "Audio bulletin plays" and which bulletins are played. The news flash carries a standing "Audio bulletin" item while bulletins are on, and the home-page panel lists the earlier bulletins of the week, each playable or saved as MP3 to listen offline.

Costs: about 25 audio tokens a second; at $9 per million audio tokens (the price until 31 December 2026, then $18) three bulletins a day cost about $3 a month. A failed bulletin is tried again after 5 minutes, at most 3 times; a slot missed by more than 2 hours (a restart) is skipped.

## Data and migration

The ZIP deliberately contains no existing reports, uploads, deletion receipt hashes, credentials, logs, .git state or local hosting identity. A fresh deployment starts with an empty report board. To move actual shared records separately, stop writes/the old server, back up its complete data directory (reports.json and media/ together), restore it on the new server, set COMMUNITY_DATA_DIR to that location, and give the Node process read/write access. Keep backups private and outside dist.

Language preferences, additional-city lists, Mayor actions, private notes and browser deletion receipts belong to each browser's local storage. They do not migrate with the code ZIP. Moving to a different origin can leave those records and receipt access in the old browser origin.

Live weather, warnings, river readings, satellite observations and external Earth/Street View links need internet access and remain subject to their providers' availability and terms.

The Open-Meteo forecasts the page shows (the 30-city daily forecast, the 30-city GloFAS river forecast and the selected city's hourly detail) are fetched by the server and shared by every visitor (`forecast-relay.mjs`, routes `/api/open-meteo/forecast` and `/api/open-meteo/flood`), because Open-Meteo's free service limits requests per internet address and many visitors share one. A copy is served for at most 15 minutes (60 for the river forecast); on an upstream failure the relay answers 502 instead of serving older data, and the page then fetches from Open-Meteo directly. Only the 30 monitored cities and the fields the page uses are accepted, so the routes are not an open proxy. Additional cities, place search and point elevation still go from the browser to Open-Meteo.

The bundled Natural Earth geography is offline reference context, not live satellite imagery. No current flood event data are fabricated or bundled as sample community reports.

## Verify the package

    npm run check

This checks the file manifest, byte counts and SHA-256 hashes. Run npm test for the included regression suite, npm run build:translations and npm run build:basemap to rebuild generated resources, and npm run bundle to regenerate the runtime folder and standalone HTML under outputs/. The work/ layout is retained so all test and fixture imports work.

Node support: https://nodejs.org/en/about/previous-releases
Full application behavior and source limitations: work/somalia-flood-watch/README.md
