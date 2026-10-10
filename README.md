# Threadline

A private, local Gantt chart creator. Plans and tasks live in this browser's `localStorage`; there is no account, backend, or network service required by the app. Existing plans saved as Daymark are carried over automatically on the same browser origin.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open the URL shown by Vite (normally **http://localhost:5173**). For a production build, run `npm run build` followed by `npm run preview`.

## Run with Docker

```sh
docker build -t threadline .
docker run --rm -p 8080:80 threadline
```

Open **http://localhost:8080**. Docker must be running. Browser storage is tied to the browser origin: plans at `localhost:5173` and `localhost:8080` are separate, and clearing browser site data removes them.

## Using the chart

- The plan sidebar starts collapsed to leave room for the timeline. Select its panel icon to show your plans, create or switch plans, then collapse it again. Edit a plan name in the page heading; delete it from the nearby menu.
- Type a name in the blank timeline row and press Enter (or click away) to create a task. Start the line with `#` to create a group, for example `# Design`. Rename any row directly in its name field. Press Enter in an existing name to jump to the blank row.
- Drag a row by its dotted handle to reorder it. Drop onto the middle of a group to nest it; drag left over a nested row to outdent it, or drop on the blank row to move it to the top level at the end. The drop highlight shows where it will go. Focus a handle and use arrow keys to reorder (up/down), nest (right), or outdent (left).
- While editing a row name, press Cmd+Up/Down (Ctrl+Up/Down on other keyboards) to move it among its siblings in the same group without losing your editing position. Dragging shows a floating preview and steadier drop targets as rows move across group boundaries.
- Right-click a row and choose **Remove row**, or use Cmd/Ctrl+Backspace while editing its name (Delete/Backspace on a focused drag handle also works). Deleting a group keeps its children and preserves dependencies on that group as links to its tasks. Group bars automatically span descendant tasks; an empty group has no date bar.
- Select the small calendar icon beside a row (or its timeline bar) to edit dates and dependencies.
- Hover over a row or bar to see its start and finish dates and the **elapsed duration** (`finish − start` in calendar days). Same-day items show `0d`; their bar still covers that date. Date endpoints are inclusive for chart placement and dependency scheduling.
- The plan summary shows the first scheduled start and last scheduled finish, with the total elapsed calendar days beside that range; it stays visible on narrow screens.
- The hover card shows the full item name, even when it does not fit in the chart. Drag the small vertical handle at the top edge of the task-name column to make names wider or narrower. Use Left/Right arrow keys on the focused handle for precise adjustment, or double-click it to reset. PNG export uses the current name-column width.
- Set each task's or group's **confidence** (0–100%) in its details. Values above 90% are green, 70–90% yellow, and below 70% red. The row indicator, percentage badge, timeline bar, hover card, and exported PNG use the same thresholds. New items and older saved plans start *not set* (gray) until assigned; group confidence is independent of its children.
- A dependency is finish-to-start: a task begins no earlier than the calendar day after every predecessor ends, shifting its end by the same number of days. A group used as a dependency means all its descendant tasks must finish. Cyclic links are not allowed.
- Dependency arrows use rounded elbows in the gaps between rows and route around intervening bars, even when a task depends on several items or rows are reordered. The PNG uses the same connector paths as the live chart.
- Drag a task bar to move it or drag either end to resize it. A focused bar also supports arrow keys to move and Shift+arrow keys to resize its end. Dependency constraints may shift a bar later than its entered dates.
- **Export PNG** downloads the entire plan, including rows hidden by collapsed groups and dates outside the visible scroll area. Its header includes task and group counts, the first scheduled start and last finish dates, and elapsed calendar days. The expand button opens a full-screen chart (and uses browser full screen where supported).
- The dates/dependencies panel stays alongside the timeline on wide screens and docks at the bottom on narrower screens; the rest of the chart remains interactive.

Run `npm test` to check scheduling, date semantics, row placement and nesting, validation, persistence format, and timeline geometry. No external services are contacted by the running app.
