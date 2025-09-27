# Brainstorm Flow Frontend

React 18 + Vite single-page app that visualizes the brainstorming pipeline, manages runs, and requests refinements from the backend.

## Features
- Canvas view of pipeline nodes with live status and zoom/drag interactions.
- Seed form with Gemini-powered template picker and suggestion generator.
- Promoted idea rail for curating standout concepts and triggering refinements.
- Refinement modals that request follow-up content (UI flow, capability breakdown, experience polish).
- Inspector sidebar exposing node IO payloads, timestamps, usage metadata, and developer tools.

## Getting Started
```bash
npm install
npm run dev
```
The dev server listens on `http://localhost:5173` by default and proxies API calls to `VITE_API_BASE` (default `http://localhost:4000`). Run the backend with `npm run dev` inside `server/` or launch both via `../start-dev.sh`.

## Environment Variables
Copy `.env.example` to `.env` and edit as needed:
- `VITE_API_BASE` – Base URL for the backend API (defaults to the local Express server).
- Optionally override the Vite dev server port via standard Vite config if port 5173 is occupied.

## Project Structure
- `src/App.tsx` – Main application wiring, canvas logic, idea promotion, and refinement handling.
- `src/api.ts` – Fetch helpers for runs, refinements, briefs, and seed templates.
- `src/hooks/useRunStream.ts` – Consumes the Server-Sent Events stream for live updates.
- `src/App.css` – Styling for the canvas, inspector, and refinement modals.
- `src/types.ts` – Shared client-side TypeScript types matching the backend payloads.

## Testing
No automated tests exist yet. When adding them, prefer Vitest and place files under `src/__tests__/` with the `*.test.tsx` naming convention.

## Production Build
Use only when cleared by a maintainer:
```bash
npm run build
npm run preview
```
Serve `dist/` from your production host and point `VITE_API_BASE` to the deployed backend.
