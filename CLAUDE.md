# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

El Nino Watch: English/Somali weather awareness, satellite flood observations,
official alerts and community flood reporting for 30 Somali cities. A plain
Node.js server (no npm dependencies) serving a static frontend.

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
npm run build:translations   # regenerate dist/translations-so.js from work/i18n-*.json
npm run build:basemap        # regenerate dist/basemap-data.js
npm run bundle               # standalone HTML under outputs/ (gitignored)
```

## Rules

- **`MANIFEST.json` pins the size and SHA-256 of every packaged file.** After
  editing a listed file, update its entry or `npm run check` fails.
  `.gitattributes` is `* -text` so line endings are never converted; keep it.
- **`dist/translations-so.js` is generated** from `work/i18n-*.json`. Edit the
  JSON and run `npm run build:translations`. It also writes
  `work/i18n-catalog-conflicts.json`, a report that is not committed.
- **Do not rename the `somalia-*` localStorage keys or the `somalia_reports`
  Docker volume.** They hold users' language choice, report receipts and
  watchlists, and deployed reports; renaming them loses that data. The app was
  renamed from "Somalia El Nino Watch" to "El Nino Watch" on 2026-10-14 and
  these were deliberately kept, as was the `work/somalia-flood-watch/` folder.
- **The repo is public.** Never commit `.env`, `data/`, uploaded reports or
  credentials. Commits use the noreply address set in this repo's git config.

## Git

- Remotes: `origin` → https://github.com/tayogroup/el-nino-watch (public),
  `backup` → `C:\Users\inawa\Documents\Claude Code\ElNinoWatch-backup\el-nino-watch.git`.
- Push both: `git push origin main` and `git push backup --all`.
