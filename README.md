# El Nino Watch

Formerly packaged as *Somalia El Nino Watch*; the app itself still uses that name in its interface.

Full application code, assets, translation and basemap rebuild inputs, test fixtures and regression tests. The current work/ directory layout is retained for reproducibility.

Extract this ZIP, install Node.js 24, open a terminal in this folder and run:

    npm start

Open http://127.0.0.1:4173. No npm install or API keys are required.

Read [DEPLOYMENT.md](DEPLOYMENT.md) for Node hosting, Docker, persistent report storage, migration, HTTPS proxy settings and validation. Read [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for resource attribution.

App files: work/somalia-flood-watch/. Frontend files under dist/ are editable source. Run npm test for the checks; npm run build:translations and npm run build:basemap regenerate resources; npm run bundle regenerates the runtime/standalone HTML under outputs/.

Current private reports, uploads, browser state and credentials are excluded. Live data still require internet access. This is an independent, non-government app; for emergency support contact your local government or relevant authority.
