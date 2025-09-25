# Repository Guidelines

## Project Structure & Module Organization
- `server/`: Node.js + TypeScript API (Express) implementing the Seed → DivergeGenerate → PackageOutput pipeline. Key folders: `src/pipeline/` (orchestration), `src/routes/` (HTTP & SSE), `src/services/` (Google GenAI client), `src/utils/` (config).
- `client/`: React 18 SPA (Vite) rendering the three-node canvas, inspector, and brief UI. Styling lives in `src/App.css`; API helpers in `src/api.ts`.
- `runs/`: Timestamped run artifacts (`graph.json`, `state.json`, `node_io/*.json`, `brief.md`, `token_usage.json`). Keep this directory gitignored.

## Build, Test, and Development Commands
- Backend dev: `cd server && npm install && npm run dev` — starts Express with tsx watch on port 4000.
- Backend build: `npm run build` then `npm start` — compiles TypeScript to `dist/` and runs the compiled server.
- Frontend dev: `cd client && npm install && npm run dev` — launches Vite dev server at http://localhost:5173 pointing to `VITE_API_BASE`.
- Frontend build: `npm run build` — produces static assets in `client/dist/`; preview with `npm run preview`.
- `./start-dev.sh` auto-cleans lingering dev servers on the reserved ports before launching fresh instances and reports any non-project processes holding them; `./stop-dev.sh` forcefully clears them when you need a manual reset.

## Coding Style & Naming Conventions
- TypeScript/JavaScript: 2-space indentation, trailing commas where valid. Prefer named functions for reusable utilities, arrow functions in React components.
- React components use PascalCase (`SeedPanel`), hooks/functions camelCase. Backend files follow kebab-case (`runPipeline.ts`).
- No automatic formatter is configured; run `npx prettier --write` before commits if you add it. Keep comments purposeful and sparse.

## Testing Guidelines
- Automated tests are not yet in place. When adding them, prefer Vitest (client) and Jest or node:test (server). Place client tests under `client/src/__tests__/` and backend tests under `server/src/__tests__/`.
- Name test files `*.test.ts(x)` and ensure they run via `npm test` scripts you add. Target critical paths: Gemini integration adapters, pipeline branching, UI event handlers.

## Commit & Pull Request Guidelines
- History is currently empty; adopt Conventional Commits (`feat:`, `fix:`, `chore:`) to keep logs scannable. Scope components (`feat: pipeline`) when practical.
- PRs should include: summary of changes, testing notes (`npm run build`, manual Gemini run), screenshots or GIFs for UI tweaks, and references to tracker tickets.

## Security & Configuration Tips
- Never commit real credentials. All `.env*` files stay local and are ignored by Git; share only `*.env.example` with placeholders.
- Rotate any leaked secrets immediately and scrub them from history before publishing.
- Prefer `start-dev.sh` / `stop-dev.sh` so secrets remain in local env files during development.
- Keep `runs/` writable but not publicly exposed; secure or disable `/runs/assets` in production deployments.
- Validate environment defaults in `server/src/utils/env.ts` whenever config changes are introduced.
- Use read-only API keys for demos. For production, restrict Gemini keys by host/IP where possible.
