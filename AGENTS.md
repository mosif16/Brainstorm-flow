# Brainstorm Flow – Agent Playbook

## Mission & Scope
- Provide an overview of the Node-Graph Brainstormer MVP for coding agents.
- Document the backend pipeline, Gemini integrations, and frontend flows so agents can navigate quickly.
- Capture operational constraints (env vars, scripts, guard rails) to avoid accidental regressions.

## Repository Topography
### Root
- `start-dev.sh`, `stop-dev.sh` orchestrate the twin dev servers (cleans ports 4000/5173 before spawn).
- `README.md` contains human onboarding; treat this file as the canonical agent guide.
- `runs/`, `logs/` (gitignored) hold generated artifacts and runtime logs; never commit.

### `server/`
- TypeScript Express API (Node 18). Entry point `server/src/index.ts` boots Express, ensures `runsDir`, mounts routers, and exposes `/health`.
- Configuration lives in `server/src/utils/env.ts`; `loadConfig()` reads env vars, pins port to 4000, derives defaults `DEFAULT_N=6`, `DEFAULT_K=3`.
- REST routes:
  * `server/src/routes/runRoutes.ts` – validates seeds, starts runs, exposes `/runs`, `/runs/:id`, `/refinements`, and `/seed/templates`.
  * `server/src/routes/graphRoutes.ts` – serves the pipeline graph consumed by the client.
- Pipeline engine `server/src/pipeline/runPipeline.ts` handles the Seed → DivergeGenerate flow, persistence, and packaging.
- Gemini adapters in `server/src/services/`:
  * `gemini.ts` – prompt scaffolding, JSON validation, usage tracking for idea generation.
  * `seedTemplates.ts` – curated templates + on-demand Gemini suggestions.
  * `refinements.ts` – structured refinement prompts per promoted idea.
  * `genAiClient.ts` – cached GoogleGenAI client.
- Server-Sent Event hub `server/src/events/runEvents.ts` fans run updates to subscribers with heartbeat + cleanup.

### `client/`
- React 18 + Vite SPA.
- Entrypoint `client/src/main.tsx`; primary canvas in `client/src/App.tsx` orchestrates pipeline cards, promoted ideas rail, and refinements.
- API helpers `client/src/api.ts` wrap REST + SSE endpoints; types in `client/src/types.ts`.
- `client/src/hooks/useRunStream.ts` listens to `/runs/:id/events` via EventSource and dispatches typed run events.
- Styling lives in `client/src/App.css` and `client/src/index.css`; assets under `client/src/assets/`.

### Tooling & Ignored Paths
- `.gitignore` protects `node_modules/`, build outputs, env files, `runs/`, and `logs/`.
- `.env.example` files exist in both `server/` and `client/`; duplicate before local runs.

## Backend Pipeline Flow
1. **Seed intake** (`server/src/routes/runRoutes.ts:normalizeSeed`) trims and validates `goal`, `audience`, `constraints`, coercing optional `n`, `k` to positive integers.
2. **Run setup** (`createRunId`, `runEventHub.create`) issues ISO-based IDs, opens an EventEmitter, and responds `202 { runId }` immediately.
3. **Seed node** (`server/src/pipeline/runPipeline.ts`) emits `node-status` + `node-io` for the sanitized seed payload and writes `runs/<id>/node_io/seed.json`.
4. **Idea generation** (`server/src/services/gemini.ts:generateIdeas`) calls Gemini with strict JSON schema enforcement; automatic retries append prompt warnings when parsing fails.
5. **Packaging** (`server/src/pipeline/runPipeline.ts`) slices top `k` ideas, formats the Markdown brief, and produces structured `PackagedBrief` sections.
6. **Persistence** writes `state.json`, `node_io/*.json`, `packaged_brief.json`, `brief.md`, and `token_usage.json` via helper writers; artifacts mirror the layout documented in `README.md`.
7. **Streaming** (`server/src/events/runEvents.ts:broadcast`) pushes `node-status`, `node-io`, and `packaged-brief` events; listeners are cleaned 60s after completion.
8. **Run completion** marks status, packages usage metrics, and returns the pipeline output consumed by `/runs/:id`.

## Gemini Integrations
- **Idea generation** (`server/src/services/gemini.ts`):
  * Enforces `ideasResponseSchema`, trimming every field and rejecting empty arrays.
  * `mapUsage` normalizes Gemini usage metadata for reporting.
- **Seed templates** (`server/src/services/seedTemplates.ts`):
  * Defines 20+ US-focused templates. `listSeedTemplates()` returns metadata for the client picker.
  * `generateSeedTemplate()` rebuilds prompts around the selected definition, calls Gemini, validates JSON, and surfaces usage info.
- **Refinements** (`server/src/services/refinements.ts`):
  * Three kinds (`ui-flow`, `capability-breakdown`, `experience-polish`) with strongly typed schemas.
  * `generateRefinement()` merges idea/context details into the prompt, validates JSON, and returns structured field maps plus usage.
- All Gemini calls route through `getGenAiClient()` to reuse clients and honour `GEMINI_API_KEY`.

## API Surface
- `GET /health` – readiness probe.
- `GET /graph` – pipeline definition consumed by the canvas.
- `POST /run` – trigger a pipeline run.
- `GET /runs` – list run summaries (newest first).
- `GET /runs/:id` – fetch state snapshot, node IO, packaged brief, and usage.
- `GET /runs/:id/events` – SSE stream (subscribe via `useRunStream`).
- `GET /runs/:id/brief` – Markdown brief download.
- `GET /seed/templates` – curated templates.
- `POST /seed/templates` – on-demand template suggestion (requires `template` or `key`).
- `POST /refinements` – generate structured follow-up prompts for a promoted idea.

## Frontend Canvas Notes
- `client/src/App.tsx`:
  * Fetches `/graph` on load to build pipeline cards.
  * Manages run lifecycle: seed form submission hits `startRun()`, SSE handler updates node states, idea grid, and packaged brief.
  * Promoted ideas and refinements leverage `generateRefinement()` and display returned field groups.
- Run inspector panes read `nodeIO` artifacts and usage metadata from `/runs/:id`.
- `useRunStream` tears down SSE connections on errors/teardown to avoid zombie listeners.
- UI state relies on the structures defined in `client/src/types.ts`; match them when extending features.

## Environment & Configuration
- Backend (`server/.env`):
  * `GEMINI_API_KEY` **required**.
  * Optional: `GEMINI_MODEL` (defaults `models/gemini-2.5-flash-lite`), `DEFAULT_N`, `DEFAULT_K`, `RUNS_DIR`.
- Frontend (`client/.env`):
  * `VITE_API_BASE`, defaulting to `http://localhost:4000`.
- Port 4000 is reserved for the API; Vite defaults to 5173.

## Development Workflow
- Install deps once: `npm install` inside both `server/` and `client/`.
- Start dev servers:
  * Manual: `cd server && npm run dev` and `cd client && npm run dev`.
  * Preferred: `./start-dev.sh` (cleans ports, launches both); stop via `./stop-dev.sh`.
- **Guard rail:** do **not** run `npm run build` in either project unless a maintainer explicitly asks.
- Use `rg` for repo searches and `code_lookup` / `semantic_search` against the MCP index for navigation.

## Testing & Observability
- Automated tests are not yet implemented; plan to add Vitest (client) or Jest/node:test (server) alongside upcoming features.
- Inspect run artifacts under `runs/<timestamp>/` for debugging; they include raw node payloads and token usage.
- Logs default to `logs/` (ignored); surface structured logging before shipping production changes.

## Security & Operational Notes
- Never commit secrets. Only check in `.env.example` files.
- Lock down `/runs/assets` in production; the dev server exposes it for convenience.
- Rotate any leaked Gemini keys immediately and scrub history if needed.
- Maintain US-market defaults baked into prompts unless requirements change; update prompt copy and validation together.

## Agent Protocol Tips
- Re-index the workspace with `ingest_codebase` after modifying files so semantic tools stay fresh.
- When touching pipeline logic, update both server types (`server/src/pipeline/types.ts`) and client counterparts (`client/src/types.ts`) to keep contract parity.
- Keep Markdown ASCII-clean; add purposeful comments only where logic is non-obvious.
- Coordinate large edits via this playbook—extend sections instead of diverging formats.
