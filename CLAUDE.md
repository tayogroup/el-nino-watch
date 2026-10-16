# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

El Nino Watch: English/Somali weather awareness, the official national flood
forecast (MOEWR), regional rainfall forecasts and alerts, satellite flood
observations and community flood reporting for 30 Somali cities. A plain Node.js server (no npm dependencies) serving a static frontend.

- `work/somalia-flood-watch/` — the app. `server.mjs` and the other `*.mjs`
  files are the server and its data relays; `dist/` is the frontend and is
  editable source, not build output.
- `work/*.test.mjs` — regression tests; `work/i18n-*.json` — the English/Somali
  translation sources; `work/basemap-source/` — basemap rebuild inputs.
- `DEPLOYMENT.md` — Node hosting, Docker, persistent report storage, HTTPS proxy.

## Commands

```bash
npm start                    # http://127.0.0.1:4173 (PORT/HOST env vars override)
npm test                     # source checks + all regression tests
npm run check                # every file in MANIFEST.json matches its SHA-256
npm run manifest             # re-pin every listed file you changed (and name each one)
npm run manifest -- <paths>  # also add new files, or drop ones you deleted
npm run build:translations   # regenerate dist/translations-so.js from work/i18n-*.json
npm run build:basemap        # regenerate dist/basemap-data.js
npm run build:sources-pdf    # print dist/sources.html to dist/el-nino-watch-sources.pdf (Edge/Chrome)
npm run build:social-image   # render work/social-preview.html to dist/social-preview.png (Edge/Chrome)
npm run bundle               # standalone HTML under outputs/ (gitignored)
```

## Rules

- **`MANIFEST.json` pins the size and SHA-256 of every packaged file.** After
  editing files, run `npm run manifest` (or `npm run check` fails); a new or
  deleted file must be named: `npm run manifest -- <path>`. Read what it prints:
  a file you did not mean to change shows up there. `.gitattributes` is
  `* -text` so git never converts line endings; keep it, and keep files LF in
  your editor too, or every file you save changes its hash.
- **`dist/translations-so.js` is generated** from `work/i18n-*.json`. Edit the
  JSON and run `npm run build:translations`. It also writes
  `work/i18n-catalog-conflicts.json`, a report that is not committed.
- **Do not rename the `somalia-*` localStorage keys or the `somalia_reports`
  Docker volume.** They hold users' language choice, report receipts and
  watchlists, and deployed reports; renaming them loses that data. The app was
  renamed from "Somalia El Nino Watch" to "El Nino Watch" on 2026-10-14 and
  these were deliberately kept, as was the `work/somalia-flood-watch/` folder.
- **The repo is public.** Never commit `.env`, `data/`, uploaded reports or
  credentials. Commit with a GitHub noreply address (the owner's is set in this
  repo's git config; a contributor uses their own noreply address), never a
  personal email.
- **Pushing to `main` deploys to the live site** within minutes, with about 20
  seconds of downtime while the single instance restarts. Work on a branch and
  merge through a pull request.

## Owner decisions

Decided by the owner, mostly on 2026-10-14 and 2026-10-15. Keep them unless the
owner says otherwise; ask before changing one. The reasoning is in the commit
messages.

**Warnings and sources**
- The Somalia National Meteorological Agency (SNMA) feed was removed and
  replaced by ICPAC's weekly exceptional-rainfall forecast (2026-10-15).
- **The official national source is the Somali National Hydrological Services,
  Ministry of Energy and Water Resources (MOEWR)**, published at
  https://hydro.tekhub.so/ (owner, 2026-10-15: it is the Ministry's own service
  and permission to use its data is held). `hydro-feed.mjs` reads each region's
  daily flood level (advisory, watch, warning; an active anticipatory-action
  pre-activation raises it to watch, activation to warning, as on the service's
  page) for the active season (Gu March-June, Deyr otherwise) and makes alerts
  for the monitored cities in each region. Middle Juba has no monitored city and
  shows only in the all-cities view; Berbera (Sahil) follows Woqooyi Galbeed.
  The data key is the public one the service's own page ships, found at run time
  (or `SNHS_SUPABASE_KEY`); never commit it.
- **Google Flood Hub** (owner, 2026-10-15) is a flood-forecasting source in
  Alerts, from Google's Flood Forecasting API (`floodhub-feed.mjs`), never by
  scraping the Flood Hub site. A gauge at Warning, Danger or Extreme level within
  25 km of a monitored city is an alert for that city (the worst gauge per
  city), badged "River forecast · Google Flood Hub". Cards use Flood Hub's own
  level words (owner, 2026-10-16), not the API's ABOVE_NORMAL / SEVERE / EXTREME,
  so they match what a reader sees on Flood Hub; "Warning level" is not MOEWR's
  national warning and stays in the Minor severity group. The API needs Google's
  waitlist approval and an API key: `GOOGLE_FLOOD_API_KEY`, set through the
  Bunny settings workflow's `source-keys` mode (DEPLOYMENT.md). Until it is set
  the source is off: the server asks Google nothing and the Alerts tab hides its
  Source option and count. The key goes in a header, never a URL; never commit
  or print it. Data under CC BY 4.0.
- **Only MOEWR alerts are "official".** Never describe ICPAC, Google Flood Hub,
  GDACS, the app's rainfall screen or the news flash as official warnings, in the UI, the meta
  description, share text or the news flash.
- The full list of outside services is the public page `/sources`
  (`dist/sources.html`), with a PDF (`dist/el-nino-watch-sources.pdf`).
  `sources-page.test.mjs` fails if the server reads a source URL the page does
  not list. After editing the page, run `npm run build:sources-pdf`.

**Language**
- Everything a visitor reads has a Somali version through the catalogue (new
  English text needs a Somali entry). Exceptions, kept as published: city names
  (shown as "Mogadishu", not "Muqdisho", in both languages), district names,
  reporters' own words, source event titles (GDACS) and news headlines.
- The Somali wording was written by Claude, not a native speaker; it is due a
  review by a Somali speaker. Prefer the words the app already uses (e.g.
  "shaandhooyinka" for filters).
- Links between the site's own pages carry the language (`data-keep-language`
  in `i18n.js`), so a Somali reader stays in Somali.

**Community reports**
- Reports are public and stay unverified. Only the person who sent a report can
  delete it, with the receipt saved in their browser; there is no admin delete,
  no expiry and no public moderation. (A public verification status was
  offered and not chosen.)
- District: optional. For Mogadishu it is a dropdown of Banadir's 20 districts
  (including Darusalam, Garasbaley and Gubadley, added in 2024; former names in
  brackets), enforced by the server; other cities keep free text.
- Landmark: an optional type (11 types: market, school, mosque, health, bridge,
  water, road, camp, airport, port, other) plus an optional free-text name.
- Feed filters: Area (the selected city's name, or All cities), City (All
  cities view only), Report type, Landmark type, District, Landmark name search
  (loose matching), observed date range (applied by the server before the
  newest-200 cut, whole East Africa Time days), and Clear all filters (resets
  Area too). Report-type count buttons sit above the feed and on the map's
  community layer; feed, dropdown and map share one Report type setting.
- On phones every filter takes a full row; nothing may be cut off at 320px in
  Somali.
- City manager view: the review-stage filter (Unreviewed / Checking / Checked
  locally / Escalated locally) is saved only in that browser; it never changes
  a report's public status.

**Alerts tab filters**: Coverage, City (all-cities coverage only; a city also
keeps Somalia-wide notices), Signal, Severity (four levels by `rank()`,
labelled with the badge words: High, severe or warning / Moderate, elevated or
national watch / Minor, rainfall watch or advisory / Not stated), Source (MOEWR,
Google Flood Hub once its key is set, ICPAC, GDACS, SWALIM gauges, the app's
Open-Meteo screen) and an "Applies from / to" date range (an alert shows when the days it
applies to touch the range). Browser notifications follow the selected filters.

**Sharing**
- Share buttons only: visitors post from their own accounts. The site holds no
  social media accounts or keys and posts nothing to social media itself.
  Automatic posting to El Nino Watch accounts was discussed and not built.
  (WhatsApp alerts, below, go only to people who signed up for them.)
- Every alert and every top-5 ranking list (Rainfall today, Rainfall next 7
  days, Flood watch next 7 days, Flooding today) has a Share row: X (Twitter),
  Facebook (link only; Facebook cannot be prefilled), Copy text, and on phones
  "TikTok, WhatsApp & more" (the phone's share menu; TikTok has no web text or
  link post).
- Every post ends with a "not an official warning" line, or for a MOEWR alert
  "Official national flood forecast (MOEWR).", which must survive X's length
  limit: `share.js` shortens it (to the row's own short form), then drops the
  lowest-ranked cities.
  Alert posts carry no "retrieved" time and do not repeat the place.
- Shared links show `dist/social-preview.png` (1200x630); its design is
  `work/social-preview.html`.

**WhatsApp alerts** (owner, 2026-10-16; `whatsapp.mjs`, `dist/whatsapp.js`,
setup in DEPLOYMENT.md): through Meta's WhatsApp Business Platform, off until
the five `WHATSAPP_*` settings are set (owner: Meta verification, number,
template, keys). Sources: MOEWR national levels, ICPAC heavy rain and Google
Flood Hub. A message only when an alert starts or gets worse for a followed
city; at most 3 a day per person, MOEWR first; the first check after switching
on sends nothing. Sign-up is "JOIN <city>" / "KU BIIR <city>" sent FROM the
person's WhatsApp (the site's button prefills it), never a number typed into the
site, so nobody can sign up someone else. STOP deletes the number. Numbers stay
in `data/whatsapp.json`, are never logged in full, and are not in the backups.
Only MOEWR messages say "official". Somali alerts depend on Meta accepting a
Somali template (`WHATSAPP_TEMPLATE_SO_LANGUAGE`); until then English.

**Public health alert** (owner, 2026-10-16): the section at the bottom of the
Alerts tab (`#health-alert` in `dist/index.html`), El Niño, flooding and disease
in Somalia, in the owner's words, sourced to six WHO documents (links checked;
the 2026 WHO analysis lists Somalia on printed page 14). It is WHO-based health
guidance, labelled "not an outbreak report" and "not an official warning"; keep
it that way. `health-alert.test.mjs` pins it, its WHO-only links and its Somali.
`/sources` lists the film (linked, `/#health-film`) and the same six WHO documents
under "Public health guidance"; `sources-page.test.mjs` fails if the two lists
drift apart.

**Health films** (`work/film/`, owner, 2026-10-16): narrated animated films,
modelled on the Healthcare Skillup course films (same owner): a storyboard JSON
per film, `film.html` draws each frame (the cholera film's handwashing, boiling,
safe storage, latrine, food and ORS demonstrations are its own animated SVG), and
`render-film.cjs` (`--stills`, `--preview` free; `--audio` for the final)
makes the MP4 and a VTT. `narrate-film.cjs` voices with Azure (dry run unless
`--go`, which bills); voiced clips in `work/film/audio/` are committed so they
are never bought twice. **A new film's script and voice need the owner's
approval before `--go`.** Cholera film: English approved and voiced (Ava HD,
2:24); Somali voiced by Ubax (3:14) from the owner's corrected script, with two
owner decisions kept in it: ORS is started at once (no "when a doctor
prescribes") and is called "daawada ORS", never a tablet ("kiniin" is the water
treatment tablet). Words drawn in the pictures go through
`W()`, translated by a storyboard's `words`.
On the site (owner, 2026-10-16): `dist/film/` holds the English film, its poster,
the English captions and Somali captions (`render-film.cjs --audio … --translation
cholera-prevention-so.json --lang so`, timed by scene). It plays near the top
of the health alert; `alerts.js` shows the captions in the page language. The
server sends `/film/` files in byte ranges (`sendFilm`; Safari and iPhones need
them) with an hour of CDN caching, so a replaced film shows within the hour.
Somali readers get the Somali film (`cholera-prevention-so.*`); `alerts.js`
swaps the film, poster and captions with the page language.
Every tab points to it: a `.film-callout` note under the first panel heading of the
overview, map, weather, community and Sources tabs ("Flood water can carry
cholera. Watch the film…"), plus the news flash, the footer and `/sources`; all
link to `#health-film`, which opens the Alerts tab (or tool) at the film.

**El Niño news flash** (`news-feed.mjs`, `dist/news-flash.js`, `/api/news`)
- A bar above the header: the app's own flashes (NOAA's El Niño status, the
  ICPAC heavy-rain city count), then items from SoDMA, FAO SWALIM, ICRC (its own
  news feed, Somalia items, plus a search of its sites; owner's request), Google News
  ("El Niño" Somalia, and Somalia floods/El Niño naming UN and non-UN
  humanitarian organisations) and ReliefWeb once `RELIEFWEB_APPNAME` is set to
  an appname ReliefWeb has approved (requested at
  https://apidoc.reliefweb.int/parameters#appname; the API refuses others).
- A standing "Public health · WHO guidance" item (`HEALTH_FLASH`, owner,
  2026-10-16) follows the app's own flashes and opens the public health alert
  (`#health-alert`); in the city manager view it opens the Alerts tool first. It
  is added after the outage check, so it never makes a dead news feed look alive.
  A second standing item, "Film · Cholera" (`FILM_FLASH`, owner, 2026-10-16),
  opens the cholera film (`#health-film`) the same way.
- **No meeting or event announcements** (`isEventAnnouncement`, Somali and
  English headline words). Of SoDMA's posts this leaves mainly its weekly
  flood-warning bulletin.
- **Excluded outlets** are `EXCLUDED_OUTLETS` in `news-feed.mjs`, each with its
  reason. Excluded at the owner's request: SONNA, Central News South Africa,
  Peoples Gazette Nigeria, Dawan Africa. Also excluded after review: advocacy
  sites (Genocide Watch), AI-written sites, aggregators (Yahoo, MSN, ...) and
  outlets with no Somalia beat. `news-flash.test.mjs` pins both the excluded
  and the kept outlets (Hiiraan Online, Horn Observer, Shabelle Media, Garowe
  Online, FTL Somalia, BBC, Africanews, Channel Africa, FloodList, ReliefWeb,
  ICRC, ...).
- Headlines are shown as published, labelled Government / UN / Humanitarian /
  Media. The bar never claims official status.

**Visits and stats**: every page load is counted (not unique visitors),
cookieless. The public `/stats` page stays hidden until 1,000 visits (lowered
from 3,000 on 2026-10-16); until then it shows only the all-time total as
progress ("327 of 1,000 visits", owner, 2026-10-16), never the breakdowns. The
owner sees everything earlier with the private `STATS_KEY`.

**Open items**: ReliefWeb appname (owner to request); Google Flood Forecasting
API access (owner to request, then set the key); WhatsApp Business setup
(owner, DEPLOYMENT.md); Somali review; optionally
limit the Google News searches to an approved list of outlets.

## Deploy

Live at https://elninowatch.so since 2026-10-14: Bunny Magic Containers app
`el-nino-watch` (App ID `75COsnmX7wS5qyD`, Frankfurt, one instance, volume
`reports` at `/app/data`), CDN endpoint `mc-01kg32atbu.b-cdn.net`. Namecheap
DNS: `@` ALIAS and `www` CNAME to that `b-cdn.net` name (Bunny's free
certificate checks for it; the `bunny.run` name serves but fails the check).
Bunny forwards the visitor's Host, so community writes work without any
pull-zone change. Pushing to `main` deploys: `.github/workflows/deploy.yml` tests, publishes
`ghcr.io/tayogroup/el-nino-watch`, and rolls the Bunny app to that commit.
Pushes that change only `*.md`, `.github/scripts/**` or the Bunny settings
workflow do not deploy. Setup and the one-instance rule are in `DEPLOYMENT.md`
under "Live hosting". The root `DEPLOYMENT.md` has that section and
`work/make-source-bundles.mjs`'s template does not; the portable ZIP bundles are
host-neutral on purpose.

Forecasts: the server relays the page's Open-Meteo requests
(`forecast-relay.mjs`, `dist/forecast-relay.js`); `app.js` still builds the
Open-Meteo URLs, so a new forecast field must also be allowed in the relay —
`forecast-relay.test.mjs` reads `app.js` and fails if they drift.

Visits: `visits.mjs` counts page loads (not people), cookieless; public at
`/stats` only after 1,000 visits (`PUBLISH_AFTER`).

Report backups: `backup.mjs` snapshots the volume to a private Bunny Storage
zone every 6 hours and soon after any report change, keeping 14 days, and
restores on start when `reports.json` is missing. Check
`https://elninowatch.so/api/backup-status`. Setup in DEPLOYMENT.md.

Bunny settings: the "Bunny settings" GitHub workflow (Actions, run by hand)
reads or changes the Bunny app's settings with the repo's secret API key. Modes:
`inspect` and `snapshots` are read-only (`snapshots` lists every report backup
and any report missing from the live site); `apply`, `create-and-apply` and
`stats-key` change live settings. Its logs are public: print names and counts,
never values. Use it rather than the Bunny dashboard, whose edits once failed to
save. Every run waits for the owner's approval (environment `bunny-settings`).

GitHub protection (2026-10-15): `main` needs a pull request with the owner's
approval (the owner, as admin, may push directly). `test.yml` runs
`npm run check` and `npm test` on every pull request. The Bunny API key belongs
only in the `production` and `bunny-settings` environments, which run from `main`
alone, so a workflow pushed on another branch cannot read it; it must not be a
repository-level secret.

## Git

- `origin` → https://github.com/tayogroup/el-nino-watch (public).
- The owner also keeps `backup` → `C:\Users\inawa\Documents\Claude Code\ElNinoWatch-backup\el-nino-watch.git`,
  a folder on the owner's computer; push both there with `git push origin main`
  and `git push backup --all`. Other contributors push to their fork or branch
  and open a pull request.
