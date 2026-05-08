# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MotivateMe is a task reminder app with motivational quotes. Users create tasks with scheduled reminders; the server delivers real-time nudges via Server-Sent Events (SSE) with curated quotes.

## Commands

### Development

```bash
npm run install:all   # Install all workspace dependencies (run once)
npm run dev           # Start both client (port 5173) and server (port 4000) concurrently
```

### Individual services

```bash
# From repo root:
npm start             # Start server only
npm run build         # Build client for production (outputs to client/dist/)

# From server/:
npm run dev           # Run Express server directly

# From client/:
npm run dev           # Run Vite dev server with /api proxy to localhost:4000
npm run preview       # Preview production build
```

### Tests

```bash
npm test              # Run server API tests (Node.js built-in test runner)
# or from server/:
npm test
```

Tests are in `server/test/api.test.js` and use `node:test` — no external test framework.

## Architecture

### Monorepo layout

```
MotivateMe/
├── client/       # React 18 + Vite + Tailwind CSS frontend
│   └── src/
│       └── main.jsx      # Entire UI: components, state, API calls (~1000 lines)
└── server/       # Node.js + Express backend (ES modules)
    └── src/
        ├── index.js              # Express app, 9 REST routes, CORS, SSE endpoint
        ├── storage.js            # TaskStore — JSON-backed CRUD with validation
        ├── reminderScheduler.js  # EventEmitter polling (15s interval), reminder dispatch
        └── content/
            └── quotes.js         # 48 local quotes (25 motivation + 23 wisdom), generation logic
```

### Client–server communication

- REST API on `http://localhost:4000/api`; Vite dev server proxies `/api` there automatically
- Real-time reminders via `GET /api/reminders/stream` (SSE / `EventSource`)
- `VITE_API_URL` env var overrides the base URL for production

### Data flow for reminders

1. User creates a task with a `reminderAt` datetime and quote preference
2. `ReminderScheduler` polls every 15 seconds; when `nextReminderAt` is past-due, it fires
3. A quote is picked from the local library (mode: `motivation`, `wisdom`, `random`, or `custom`)
4. Reminder event is pushed to all SSE clients; client shows a banner and optional browser notification
5. Snoozing advances `nextReminderAt` by 5/10/20 minutes; repeat nudges re-fire every N minutes until the task is completed

### Storage

Tasks are persisted in `server/src/data/tasks.json` — a flat JSON array. No database. `TaskStore` (in `storage.js`) handles async read/write with full field validation and returns 400 with an error array on invalid input.

### Frontend state

All React state lives in the root `App` component using `useState`/`useEffect`/`useMemo`. No global state manager. All components are defined in `main.jsx`.

## Environment variables

**Server** (`server/.env`):
```
PORT=4000
FRONTEND_URL=http://localhost:5173   # Added to CORS allowlist
NODE_ENV=production
```

**Client** (`client/.env.local`):
```
VITE_API_URL=http://localhost:4000
```

## Deployment

- **Backend → Render**: root directory `server`, build `npm install`, start `npm start`, health check `/api/health`
- **Frontend → Vercel**: root directory `client`, build `npm run build`, output `dist`
- The JSON task file on Render is ephemeral; persistent storage would require a database migration

## UX and Product Constraints
- UI must remain clean, minimal, and professional
- Avoid childish or overly gamified language (no "mission cleared")
- Animations should be subtle and purposeful
- Preserve existing behaviors:
  - reminder scheduling
  - snooze logic
  - notification system
  - completion celebration
- Do not introduce breaking changes
- Keep task cards compact; use modals or collapsible sections for advanced features

## Verification Requirements
- Run `npm test`
- Run `npm run build`
- Fix any errors before completing the task
