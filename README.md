<img src="public/logo.svg" alt="Concurrent Crocodiles" width="330" height="80">

**An intuitive app that helps you plan task concurrency.**

Create tasks and their dependencies. Tasks auto-arrange as their priority and status change. 

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Usage](#usage)
- [HTTP API](#http-api)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Testing](#testing)

## Features

### Derived from the graph

| | |
|---|---|
| **Three statuses** | *In progress* — every prerequisite is complete, so the task is startable. *To do* — waiting on a prerequisite, or blocked. *Done* — the only status you assert. Nodes and list rows are coloured accordingly. |
| **Self-arranging board** | Columns are dependency depth, rows are priority. Because layout is a pure function of the graph, the editor, the share view and an exported image all draw the same board. |
| **Inherited urgency** | Raising a task to P1 lifts the entire chain it depends on, so the path to important work reads across the top. |
| **Animated transitions** | When the layout changes, nodes and arrows move to their new positions over approximately one second, which keeps a task trackable across a re-sort. Disabled under `prefers-reduced-motion`. |


### Editing

- **Canvas-first.** Double-click the canvas to create a task in place. Drag from a node's ○ port to another node to draw a dependency; click an arrow to remove it. Dragging anywhere else pans the board.
- **Forward graph construction.** Dragging a ○ into empty space prompts for a title and then draws the arrow to the new task. The `a` key does the same for the selected task, so chains can be built without leaving the keyboard.
- **Quick-add syntax.** `Fix login bug !1 #deep-work >deploy *waiting-on-bob` sets priority, goal, dependency and blocker in one line. See [Quick-add syntax](#quick-add-syntax).
- **Priorities P1–P3**, one key each, shown on the crocodile's tail. `s` sorts the to-do queue by priority.
- **Blockers.** An external reason a task cannot start. A blocked task is held at *to do* however clear its prerequisites are.
- **Goals.** Tasks map to goals via `#goal`; a sidebar panel reports completion per goal.
- **Keyboard operation.** `f` and `g` walk the board downstream along the arrows, so a chain is followed to its end before the next begins. Every other action is a single key; press `?` for the full list.

### Housekeeping

- **Automatic sweep.** Completing a task starts a five-second countdown, after which the task is deleted. Reopening it cancels the countdown, which is the undo mechanism and the reason the interval is five seconds rather than one. A task connected to others waits for the whole run of joined work to finish, so a completed chain is removed together rather than leaving arrows pointing at nothing. Only work the application observed being completed is swept; work already complete at load is left alone. Toggle with 🧹.
- **Bulk clear.** The `clear` control on the Done group removes completed tasks; `u` or ⌘Z restores them along with their dependency links, without disturbing unrelated edits made in the meantime. This is the tool for a backlog the sweep never saw.

### Sharing and export

- **Live share link.** A read-only view that polls the plan every five seconds. It renders no completion buttons, no ports and no clickable arrows.
- **Image and document export.** PNG or PDF of the canvas in the current theme, or JSON of the entire graph.
- **HTTP API.** Read the plan, modify it a task at a time, or fetch it whole and submit it back edited. See [HTTP API](#http-api).

### Presentation

- **Tasks are drawn as crocodiles**, seen from above, rather than as cards bearing a crocodile. Colour is status, the tail is priority, the eyes are open while work remains and closed when it is complete, and the jaws show teeth on startable tasks. `?` opens the legend.
- **Water canvas** (`w`). The board sits on a plain dot grid by default; the toggle floats it on a still, lit pool instead, with a ripple crossing it every five to seventeen seconds. The surface is two fields of Perlin noise shaped by SVG filters — no raster images and no `<canvas>`.
- **Light and dark themes** (`m`). Follows the operating system preference until a choice is made, then persists per device and is applied before first paint.

## Requirements

- **Docker Compose**, or
- **Node.js 20.9 or newer** for local development.

## Getting started

### Docker

```bash
docker compose up -d --build
```

The application is served at <http://localhost:3001>. Compose starts the app together with PostgreSQL 16; the plan is stored in the `pgdata` named volume and survives restarts, rebuilds and `docker compose down`. Only `docker compose down -v` removes it. Rebuild with the same command after pulling changes.

The live-share view is reachable by anyone who can reach the host: `http://<host>:3001/share/<token>`.

### Local development

```bash
npm install
npm run dev
```

Without `DATABASE_URL` the plan is stored in `data/plan.json`, with `localStorage` as a fallback when the server is unreachable.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm start` | serve the production build |
| `npm run lint` | ESLint |
| `npm test` | unit and component tests |
| `npm run test:e2e` | end-to-end tests |
| `npm run test:all` | both suites |

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `DATABASE_URL` | unset | When set, the plan is stored in PostgreSQL as a single JSONB document. When unset, it is stored in `data/plan.json`. |
| `PORT` | `3000` | Port the production server binds to. |

Theme, canvas style and sweep are per-device preferences held in `localStorage`, not part of the plan, and therefore not shared by a share link.

## Usage

A typical session:

1. Press `n` and enter tasks in sequence. The input retains focus, one task per Enter.
2. Add tokens inline as needed: `Write report !1 #deep-work`, `Ship it *waiting-on-legal`.
3. Draw the dependencies — drag from a node's ○ port onto the task that must wait for it, or into empty space to name that task on the spot.
4. Read the leftmost column. It lists what can be started now, and how much can be started concurrently.
5. Set priorities with `1`–`3`. Important work rises to the top, and its prerequisites rise with it.
6. Mark tasks complete; the next column becomes startable, and finished chains count down and remove themselves.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `n` · `c` · `⌘K` | quick-add task |
| `a` | new task depending on the selected one |
| `f` · `g` or `↑` · `↓` | focus previous / next task, downstream along the arrows |
| `Shift+J` · `Shift+K` | move task down / up the to-do queue |
| `Enter` · `e` | edit selected task |
| `d` | toggle done |
| `b` | toggle blocked |
| `1`–`3` | set priority; the board re-sorts |
| `s` | sort the to-do queue by priority |
| `x` · `Del` | delete selected task |
| `u` · `⌘Z` | undo the last bulk clear |
| `m` | light / dark theme |
| `w` | water / plain canvas |
| `?` | help overlay |
| `Esc` | close panels, or deselect |

Pointer actions on the canvas: double-click to create a task · drag ○ onto a node to add a dependency · click ○, or drag it into empty space, to create a dependent task · click an arrow to remove that dependency · drag elsewhere to pan.

### Quick-add syntax

```
Fix login bug !1 #deep-work >deploy *waiting-on-bob ^
```

| Token | Meaning |
|---|---|
| `!1`…`!3` | priority |
| `#goal` | goal, created if it does not exist |
| `>prefix` | depends on the task whose title starts with `prefix` |
| `*reason` | blocked, with a reason |
| `^` | insert at the front of the to-do queue |

Anything that is not a token becomes part of the title.

## HTTP API

Every operation the application performs on a plan is available over HTTP. `GET /api` lists the endpoints; `GET /api/export` returns the entire plan as one JSON document.

One rule governs the whole surface: **status is derived and never stored.** Clients send `done`, `blocked` and `dependsOn`, and read `status`, `depth` and `dependents` back. Writing a status is not permitted, because the graph already determines it.

Responses are `{"ok": true, …}` or `{"ok": false, "error": "…", "details": [...]}`, where `details` reports every problem with the request rather than the first one encountered. A rejected write changes nothing.

### Export

```bash
curl localhost:3000/api/export                  # goals, tasks, dependencies, derived state, totals
curl -OJ localhost:3000/api/export?download=1   # as a file attachment
curl localhost:3000/api/export?pretty=0         # compact
curl localhost:3000/api/export?format=plan      # the stored document, without derived fields
```

The document expresses the graph twice — `dependsOn` and `dependents` on each task, plus a flat `dependencies` edge list — so it can be read whichever way suits the consumer. The application's `JSON` button downloads the identical document.

### Tasks

| Endpoint | Description |
|---|---|
| `GET /api/tasks` | every task with its derived state, plus goals, edges and totals |
| `POST /api/tasks` | create: one task, `{"tasks": [...]}`, or `{"quickAdd": ["Write report !1 #deep-work"]}` |
| `PATCH /api/tasks` | update many: `{"tasks": [{"id": "a1b2", "done": true}]}` |
| `PUT /api/tasks` | replace the entire list |
| `DELETE /api/tasks` | `?ids=a,b` or `?done=true` |
| `GET` `PATCH` `PUT` `DELETE` `/api/tasks/{id}` | a single task; `PUT` also resets fields omitted from the request |
| `GET` `POST` `PUT` `DELETE` `/api/tasks/{id}/dependencies` | the edges into and out of a single task |

Filters on `GET /api/tasks`, all optional and combined with AND: `?status=in-progress,todo` · `?goal=deep-work` (or `?goal=none`) · `?q=text` · `?done=` · `?blocked=` · `?dependsOn={id}` · `?blocking={id}`. Filters narrow `tasks` only; the accompanying goals, edges and totals always describe the whole plan.

```bash
# what can be started right now
curl 'localhost:3000/api/tasks?status=in-progress' | jq '.tasks[].title'

# add a task that waits on another
curl -X POST localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"title": "Ship it", "priority": 1, "goal": "release", "dependsOn": ["a1b2"]}'

# complete a task; its dependents become in-progress automatically
curl -X PATCH localhost:3000/api/tasks/a1b2 -H 'content-type: application/json' -d '{"done": true}'
```

A task may name its goal in words (`"goal": "release"`), which creates the goal if it does not exist, exactly as `#release` does in quick-add.

### Batch and round trip

`POST /api/batch` applies a complete set of changes atomically: the edit is assembled and validated before anything is stored, so if any part is rejected, none of it is applied.

```jsonc
{
  "goals":    { "create": [...], "update": [...], "delete": ["id"] },
  "create":   [{ "title": "Retro", "dependsOn": ["c3d4"] }],
  "quickAdd": ["Write report !1 #deep-work"],
  "update":   [{ "id": "a1b2", "done": true }],
  "delete":   ["e5f6"]
}
```

Because only the final plan is validated, a batch may pass through intermediate states the graph would otherwise reject — adding an edge and removing it again, or deleting a prerequisite together with the task that required it.

The round trip is the alternative form: fetch everything, edit the array, submit it back.

```bash
curl -s localhost:3000/api/tasks | jq '{tasks}' > plan.json
$EDITOR plan.json
curl -X PUT localhost:3000/api/tasks -H 'content-type: application/json' -d @plan.json
```

`PUT /api/tasks` — and `POST /api/batch` with a `tasks` key — treats the submitted list as complete: known ids are updated, unknown ids are created, and **anything absent is deleted**. Derived fields are ignored on input, as are field names the model does not use, so any document this application has exported can be submitted back unmodified.

### Goals and import

`GET` `POST` `PATCH` `DELETE` `/api/goals` and `GET` `PATCH` `DELETE` `/api/goals/{id}`. Each goal reports how many tasks are mapped to it and how many are complete. Deleting a goal unassigns its tasks; it never deletes work.

`POST /api/import` accepts a document — an export from this application, or anything with the same `tasks` and `goals` shape. The default mode replaces the plan; `?mode=merge` upserts by id instead. A replace retains the existing share token, so links already distributed continue to work.

### Operational notes

**The API is unauthenticated**, and is exactly as accessible as the application it edits. This is appropriate for a local or trusted-network deployment and should be considered before exposing the port more widely.

**An open browser tab will overwrite API changes.** The browser holds the plan in memory and autosaves the whole document, so a change made through the API while a tab is open is lost the next time anything in that tab changes. Reload the tab after driving the API, or drive it with no tab open. Concurrent API calls are safe: writes are queued server-side.

## Architecture

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Zustand with Immer · html-to-image and jsPDF. Persistence is a single JSON document behind an API route, held in PostgreSQL when `DATABASE_URL` is set and on disk otherwise. The browser autosaves the whole plan on a 600 ms debounce.

**The derived core is pure and lives in three modules.** `lib/graph.ts` turns tasks and dependencies into statuses, inherited urgency, depths and the runs of completed work the sweep may remove. `lib/flow.ts` turns those into canvas positions and the order the keyboard traverses them. `lib/parse.ts` implements the quick-add grammar. None of them touch React, the network or the clock, which is why the same functions serve the editor, the share view and the API.

**No position is stored.** The plan document contains no coordinates. `lib/flow-motion.ts` is the one impure piece: given a new set of target positions it returns the intermediate ones, a frame at a time for one second. It interpolates in React rather than in CSS because an SVG path cannot be transitioned and the arrows must arrive with the nodes, so every frame is a render and the edges are drawn from the same intermediate positions.

**The API is three modules behind thin route handlers.** `lib/plan-ops.ts` implements every write as a function from one plan to the next, together with everything it refuses. `lib/plan-doc.ts` builds the derived view that is handed out, and is shared with the browser's JSON button so that the download and the endpoint return an identical document. `lib/plan-store.ts` performs the read-modify-write, queued so concurrent calls cannot overwrite one another.

**One palette in one file.** `app/globals.css` defines both themes as a single set of custom properties, with the Tailwind colour ramp re-pointed onto a single green hue. A status publishes two colours and nothing more; the sidebar row and the canvas crocodile each decide what to do with them. The water surface is defined there as `.croc-surface`, with `components/WaterSurface.tsx` emitting the occasional ripple.

**Interface scale is a single declaration.** `html { font-size }` in the same file. Every length is expressed in rem — the four named type sizes, the spacing scale, the panel widths — so one percentage scales type, padding and panels together. The task node is the only element sized in pixels (`FLOW` in `lib/types.ts`), and the crocodile is a viewBox stretched to fit it.

**The drawings.** `components/CrocShape.tsx` renders a task: one outline, one limb drawn once and mirrored into four corners, and a torso that serves as the card. It takes fill and stroke by inheritance rather than by CSS rule, because html-to-image deep-clones an `<svg>` without inlining styles onto its children — a rule that renders correctly on screen would export as a black silhouette. The mark is drawn separately for the contexts a task node cannot occupy: `components/Logo.tsx` in the application, `app/icon.svg` for the tab, and `public/logo.svg` for the lockup above.

## Project structure

```
app/            routes, API handlers, global stylesheet
  api/          the HTTP API
  share/        the read-only share view
components/     React components, including the crocodile and water rendering
lib/            derived core, store, persistence, parsing, export
tests/          unit and component tests (Vitest)
e2e/            end-to-end tests (Playwright)
data/           plan.json, when no database is configured (created at runtime)
```

## Testing

```bash
npm test          # unit and component — Vitest, jsdom
npm run test:e2e  # end-to-end — Playwright, Chromium; starts its own dev server
npm run test:all  # both
```

The suites are split by what each can demonstrate:

- **`tests/`** — the derived core in isolation: statuses computed from a graph, urgency propagating back along a chain, the resulting layout and navigation order, the quick-add grammar, every store action, the sweep's timing, and every API route against a temporary directory and a stubbed database — covering what they refuse as much as what they accept, and confirming that a rejected write leaves the stored plan untouched.
- **`e2e/`** — the application in a browser: quick-add through to a rendered node, the frontier advancing as work is completed, the board re-sorting and animating on a priority change, completed work counting down and removing itself, dependency drawing, panning, keyboard-only operation, themes applied before first paint, the JSON download, and the share link's read-only guarantee.

The end-to-end suite stubs `/api/plan` in the browser at context scope, so **no run reads or writes a real `data/plan.json`**; that route is covered by unit tests instead.
