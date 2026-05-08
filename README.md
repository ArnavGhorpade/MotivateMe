# MotivateMe

MotivateMe is a polished full-stack MVP for students who want task reminders with short motivational or reflective encouragement. Users create tasks, choose reminder timing, select a quote style, optionally repeat nudges until complete, snooze reminders, mark tasks complete, delete tasks, and receive simulated reminders through server console logs, in-app toasts, and optional browser notifications.

## Requirements Plan

- Task creation with title, optional description, and scheduled reminder date/time.
- JSON-backed persistence in the Node/Express backend.
- REST API for listing, creating, updating, and deleting tasks.
- Reminder scheduler that checks each task's exact `nextReminderAt` and emits simulated reminders.
- Reminder timing offsets: exact scheduled time, 5 minutes before, 10 minutes before, 20 minutes before, or a custom value up to 1440 minutes.
- Repeat nudges for unfinished tasks: no repeat, every 5 minutes, every 10 minutes, every 20 minutes, or a custom value up to 1440 minutes.
- Snooze support for active reminders: 5, 10, or 20 minutes.
- Polished in-app toast notifications for create, complete, delete, reminder, and snooze events.
- Optional browser Notification API support for actual reminders only.
- Local-first quote system with motivation, wisdom, random, and custom-message modes.
- Local quote library with 40-50 quote entries. Each entry has `text`, `author`, and `type`.
- Curated local quote generation with no external quote or AI dependency.
- React + Tailwind responsive UI with task form, task list, status badges, reminder times, and notification banner.

## Project Structure

```text
MotivateMe/
  client/                 React + Vite + Tailwind frontend
    src/main.jsx          Main app UI and API wiring
    src/styles.css        Tailwind layers and shared inputs
  server/                 Node + Express backend
    src/content/          Extensible content generators and local quote library
    src/data/tasks.json   Local JSON task storage
    src/index.js          Express app and routes
    src/reminderScheduler.js
    src/storage.js
    test/api.test.js      Basic API tests
  package.json            Workspace scripts
```

## Setup

```bash
npm install
```

Create `server/.env` if you want to customize the API port:

```bash
PORT=4000
FRONTEND_URL=http://localhost:5173
```

Create `client/.env.local` only if your local backend is not on `http://localhost:4000`:

```bash
VITE_API_URL=http://localhost:4000
```

MotivateMe works entirely from local task storage and the curated quote library.

## Run The App

Run the backend and frontend together:

```bash
npm run dev
```

Then open:

- Frontend: http://127.0.0.1:5173
- Backend API: http://localhost:4000/api/health

You can also run them separately:

```bash
npm run dev --workspace server
npm run dev --workspace client
```

## Deployment

Deploy the backend to Render first, then deploy the frontend to Vercel with the Render backend URL.

### Render Backend

Create a new Render Web Service:

- Root Directory: `server`
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Required Render environment variables:

```bash
NODE_ENV=production
FRONTEND_URL=https://your-vercel-app.vercel.app
```

Optional Render environment variables:

```bash
PORT=4000
```

After deployment, copy the Render service URL, for example:

```bash
https://motivateme-api.onrender.com
```

Note: the current MVP uses JSON file storage on the backend instance. This is fine for a demo, but Render instance files are not durable database storage for production use.

### Vercel Frontend

Create a new Vercel project:

- Framework Preset: `Vite`
- Root Directory: `client`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

Required Vercel environment variable:

```bash
VITE_API_URL=https://your-render-service.onrender.com
```

After Vercel gives you the frontend URL, set the same URL as `FRONTEND_URL` in Render, then redeploy the Render service so CORS allows the deployed frontend.

Local fallback behavior:

- If `VITE_API_URL` is missing, the frontend uses `http://localhost:4000`.
- The backend allows `http://localhost:5173`, `http://127.0.0.1:5173`, and `FRONTEND_URL`.

## API

- `GET /api/tasks` lists tasks.
- `POST /api/tasks` creates a task.
- `PATCH /api/tasks/:id` updates a task, including completion status.
- `DELETE /api/tasks/:id` deletes a task and stops future reminders.
- `POST /api/tasks/:id/snooze` moves `nextReminderAt` by 5, 10, or 20 minutes without completing the task.
- `POST /api/content/quote` generates or resolves a quote for the supplied task title and quote preference.
- `POST /api/content/motivational-quote` remains as a backwards-compatible motivation endpoint.
- `GET /api/reminders/stream` streams reminder events to the frontend.

## Quote Modes

- `motivation`: short, action-focused encouragement.
- `wisdom`: reflective quotes from known people when attribution is reliable, otherwise `Unknown`.
- `random`: chooses either motivation or wisdom locally.
- `custom`: uses the user's message directly with author `You`.
- Quotes are resolved locally. Custom messages use the user's message directly with author `You`.

## Progressive Nudges and Tone

Each task carries a `nudgeTone`: `supportive`, `direct`, or `tough`. The default is `supportive`. The tone shapes the language of repeat nudges so the same task can feel calm and encouraging, clear and action-oriented, or disciplined and no-excuses depending on what the user asked for.

- `supportive`: low-pressure encouragement. Reduces friction.
- `direct`: clear, action-oriented language. No filler.
- `tough`: firm and uncomfortable, like a disciplined coach. Tough nudges criticize avoidance, never the user. They contain no profanity, insults, personal attacks, or references to sensitive traits, mental health, body image, or personal worth.

Repeat reminders progress through three stages based on `reminderCount`:

1. **Initial reminder** (`reminderCount` is 0 going in): uses the selected quote preference. Motivation, wisdom, random, or the user's custom message.
2. **Micro-start nudge** (after 1 reminder has fired): a short "do two minutes" nudge in the selected tone, designed to make starting feel easy and immediate.
3. **Identity nudge** (after 2+ reminders have fired): a follow-through nudge in the selected tone, focused on consistency, momentum, and the kind of person who follows through.

Each `lastReminder` stores `text`, `author`, `type` (`motivation`/`wisdom`/`custom`/`micro-start`/`identity`), `source` (`local`/`custom`/`nudge`), `tone`, `stage`, and human-readable `sourceLabel` and `toneLabel` fields so the UI can show, for example, "Curated local quote" or "Micro-start nudge · Direct tone" without rebuilding the labels.

Custom message behavior: the first reminder uses the user's custom message verbatim. Repeat reminders switch to progressive nudges in the selected tone, since holding the same custom line for many repeats does not push the task forward. If you want every reminder to use the exact custom phrase, set the repeat interval to "No repeat" so only the first reminder fires.

## Reminder Controls

Each task stores:

- `reminderAt`: the scheduled task date/time.
- `reminderOffsetMinutes`: `0`, `5`, `10`, `20`, or a custom value from 1 to 1440, used to calculate the first reminder.
- `repeatIntervalMinutes`: `0`, `5`, `10`, `20`, or a custom value from 1 to 1440, used after the first reminder if the task remains unfinished.
- `nextReminderAt`: the exact next reminder time shown in the UI and used by the scheduler.

Repeat reminders use the same quote preference as the original task. Custom messages repeat exactly as written. Marking a task complete or deleting it stops future repeat reminders.

## Notifications

- In-app toasts auto-dismiss after a few seconds and remain the default feedback system.
- Delete confirmation uses a styled in-app modal rather than the browser confirm dialog.
- Browser/system notifications are optional and only requested when the user clicks `Enable browser notifications`.
- If browser notifications are denied or unavailable, in-app reminders still work normally.

## Verification

```bash
npm test
npm run build
```

Manual checklist:

- Add a task with a reminder time one minute from now.
- Choose a reminder timing offset and confirm the task card shows the exact next reminder time.
- Choose a custom reminder timing value and confirm validation works.
- Choose a repeat interval or custom repeat value and confirm it appears in task details.
- Select Motivation, Wisdom, Random, or Custom message and confirm it appears in the task card.
- Pick a nudge tone (Supportive, Direct, or Tough) and confirm it shows in the task details.
- For an unfinished task with repeats enabled, confirm the second reminder is a micro-start nudge in the selected tone, and the third+ are identity nudges.
- Mark it complete and confirm the completed status.
- Delete a task and confirm it disappears after confirmation.
- Add another task due soon and leave it pending.
- Confirm the backend logs a reminder and the frontend shows a banner with quote/message and author.
- Snooze a reminder for 5, 10, or 20 minutes and confirm the task card's next reminder time updates.
- Click `Enable browser notifications`, grant permission if desired, and confirm future reminders can use system notifications.
- For an unfinished task with repeats enabled, confirm another reminder appears after the selected interval.

## Future Improvements

- Add authentication and per-user task lists.
- Support recurring reminders and calendar integrations.
- Add browser push notifications or email/SMS delivery.
- Add more content generator types, such as jokes, memes, or study tips.
- Replace JSON storage with SQLite or Postgres for multi-user reliability.
