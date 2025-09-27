# Node-Graph Brainstormer MVP

Full-stack brainstorming assistant that orchestrates a two-stage pipeline (Seed → DivergeGenerate) and automatically packages the best concepts into a shareable brief. The backend runs on Express + TypeScript with Google Gemini, and the frontend is a React 18 canvas for monitoring runs, promoting ideas, and deepening concepts.

## Features
- **Pipeline automation** – Validates the seed, caps idea counts, runs DivergeGenerate with Gemini, and packages the top concepts into an executive brief.
- **Streaming backend** – Server-Sent Events broadcast node status, node IO payloads, and packaged brief updates in real time.
- **Run persistence** – Every run writes graph metadata, per-node IO snapshots, packaged brief JSON, Markdown brief, and usage metrics to `runs/<timestamp>/`.
- **Concept refinements** – Dedicated `/refinements` endpoint turns promoted concepts into structured follow-up prompts (UI flow, capability breakdown, experience polish).
- **Seed templates** – `/seed/templates` exposes curated US-focused prompt scaffolds plus on-demand Gemini suggestions to jump-start ideation.
- **Canvas UI** – React client highlights pipeline progress, lets you promote ideas, request refinements, inspect IO history, and download briefs in one place.

## Prerequisites
- Node.js 18 or newer.
- Valid `GEMINI_API_KEY` with access to the configured Gemini model (`GEMINI_MODEL`, default `models/gemini-2.5-flash-lite`).

## Setup
```bash
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

## Environment Variables
Duplicate the provided examples and fill in your own values:
```
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Then edit:
- `server/.env` for backend keys:
  - `GEMINI_API_KEY=your_key_here`
  - `DEFAULT_N=6`, `DEFAULT_K=3` (pipeline defaults)
  - `RUNS_DIR=../runs` (artifact location)
  - `GEMINI_MODEL=models/gemini-2.5-flash-lite` (optional model override)
- `client/.env` for frontend config:
  - `VITE_API_BASE=http://localhost:4000`
  - Frontend dev server port defaults to `5173` (override via Vite if needed).

## Development Workflow
```bash
# Manual split terminals
cd server && npm run dev
cd client && npm run dev
```
The frontend dev server listens on `http://localhost:5173` and proxies API calls to `VITE_API_BASE`. Alternatively, run `./start-dev.sh` from the repo root to clean up ports 4000/5173 and launch both services together. Use `./stop-dev.sh` to terminate lingering dev processes.

## API Overview
- `GET /health` – readiness check.
- `GET /graph` – pipeline definition used by the client canvas.
- `POST /run` – trigger the pipeline.
  - Body: `{ goal, audience, constraints, n?, k? }`
  - Response: `{ runId }` (202 Accepted)
- `GET /runs` – list stored runs (newest first).
- `GET /runs/:id` – retrieve run state, node IO, optional brief markdown, and usage.
- `GET /runs/:id/events` – Server-Sent Events stream of pipeline and brief updates.
- `GET /runs/:id/brief` – download the Markdown brief.
- `GET /seed/templates` – list available seed templates (label, tagline, scenario, focus, angle).
- `POST /seed/templates` – generate a fresh seed suggestion from a template `{ template | key }`.
- `POST /refinements` – request a structured refinement for a promoted idea `{ kind, idea, context? }`.

## Seed Templates & Refinements
Seed template scenarios are defined in `server/src/services/seedTemplates.ts` and expose structured US-market briefs. The client surfaces them in the seed form for quick population, and also lets you request Gemini-generated variations before launching the pipeline. Promoted ideas in the UI can request refinements (UI flow, capability breakdown, experience polish) via the `/refinements` endpoint, returning structured fields that slot directly into planning docs.

## Run Persistence Layout
```
runs/
  2025-09-24T18-16-05-123Z/
    graph.json
    state.json
    token_usage.json
    packaged_brief.json
    brief.md
    node_io/
      seed.json
      divergeGenerate.json
```

## Frontend Highlights
- Node cards update live with status transitions, timestamps, and IO payloads.
- Promote standout ideas to the right rail, annotate them, and download packaged briefs.
- Request refinements per promoted idea, with fetched responses stored alongside the run.
- Inspector sidebar exposes raw node IO, usage metadata, and developer tooling toggles.
- Run history preserves previous executions for quick recall.

## Production Build
```bash
# Backend
cd server
npm run build
npm start

# Frontend
cd client
npm run build
npm run preview  # or serve client/dist via your host
```
Serve the built frontend from your preferred static host and point `VITE_API_BASE` to the deployed backend.

## Notes
- No mock mode exists; ensure `GEMINI_API_KEY` is set before starting the backend.
- Pipeline packaging always caps ideas at 6 and ensures at least one concept is selected for the brief.
- SSE connections remain open for 60 seconds after completion so the client can finish syncing.
