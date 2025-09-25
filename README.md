# Node-Graph Brainstormer MVP

Full-stack brainstorming assistant that runs a three-node pipeline (Seed → DivergeGenerate → PackageOutput) backed by Gemini generation and a React canvas UI.

## Features
- **Node.js + TypeScript backend** with Express, streaming status updates (SSE), and disk persistence under `runs/<timestamp>/`.
- **Google GenAI SDK integration** (server-side only) with structured output enforcement and automatic retry on malformed responses.
- **React 18 frontend** with a minimal Comfy-style node canvas, live inspector, pipeline controls, and Markdown brief viewer/downloader.
- **Run artifacts**: graph structure, per-node IO snapshots, final brief, and token usage logs stored per run.

## Prerequisites
- Node.js 18+.
- A valid `GEMINI_API_KEY` with access to the configured Gemini model (`GEMINI_MODEL`, default `models/gemini-2.5-flash-lite`).

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
  - Frontend port is fixed to `5173`.

## Development Workflow
```bash
# Terminal 1 - backend
cd server
npm run dev

# Terminal 2 - frontend
cd client
npm run dev
```
Front-end dev server runs at `http://localhost:5173` and proxies requests to the configured backend address. The helper scripts automatically stop lingering dev servers on the fixed ports (4000 and 5173) before launching new ones and surface the owning process if manual cleanup is required.

## API Overview
- `GET /health` – simple readiness check.
- `GET /graph` – static description of nodes and edges.
- `POST /run` – trigger full pipeline.
  - Body: `{ goal, audience, constraints, n?, k? }`
  - Response: `{ runId }` (202 Accepted)
- `GET /runs` – list stored/pending runs (sorted newest first).
- `GET /runs/:id` – detailed run state, node IO, brief markdown, usage.
- `GET /runs/:id/events` – Server-Sent Events stream for live node updates.
- `GET /runs/:id/brief` – direct download of the Markdown brief.

## Run Persistence Layout
```
runs/
  2025-09-24T18-16-05-123Z/
    graph.json
    state.json
    token_usage.json
    brief.md
    packaged_brief.json
    node_io/
      seed.json
      divergeGenerate.json
```

## Frontend Highlights
- Canvas highlights node status (`pending → running → completed/failed`).
- Inspector shows inputs/outputs, timestamps, and errors for the selected node.
- Output panel renders the Markdown brief and exposes a download button.
- Run history list lets you revisit previous executions.

## Production Build
```bash
# Backend
cd server
npm run build
npm start

# Frontend
cd client
npm run build
npm run preview  # or serve dist/ via your static host
```
Serve the built frontend from your preferred static host and point `VITE_API_BASE` to the deployed backend.

## Notes
- There is no mock mode; ensure `GEMINI_API_KEY` is present before running the backend.
- The backend validates Gemini JSON output and repeats the call once before surfacing an error.
- SSE connections are kept for 60 seconds after run completion for client catch-up.
