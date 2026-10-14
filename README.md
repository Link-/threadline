# Threadline

A private, local Gantt chart creator. Plans and tasks live in this browser's `localStorage`; there is no account, backend, or network service required by the app. Drag task bars sideways to change dates or drag task and group bars vertically to reorder and nest rows; the name list follows the timeline. Single-click a plain task or group name to see its details; double-click any name (or press F2) to edit it, with details remaining visible. Names written as `[label](https://example.com)` become clickable links; a single click opens the URL in a new window after a brief pause so a double-click can still edit the name. Plan files keep the full Markdown name, while PNG exports show only its label, never the link URL. Enter finishes editing a name; ⌘/Ctrl+Enter adds a task immediately below it (inside a group if editing its name). Use the bottom row for new top-level tasks and groups. Mark tasks done using the checkbox beside their names or in their details; completed tasks remain on the timeline with their dates and dependencies unchanged and appear as checked, muted bars. Completion is retained in plan files and PNG exports. Click an importance or confidence badge to edit that property, or a task's duration to enter a number of calendar days; editing duration keeps its planned start fixed and adjusts only its end date, while dependencies can still shift its displayed dates. Group child counts and durations are calculated from their children. The task-name pane width is saved separately for each plan. Tasks and groups can have an optional importance pill (Critical, Investment, Debt, Stretch goal, or Optional), retained in plan files and PNG exports. Use **Save locally** to download the active plan as a `.threadline.json` file. **Import plan** accepts either a file upload or pasted JSON and offers a copyable or downloadable prompt for an AI agent to generate a compatible plan from your Markdown tasks. Existing plans saved as Daymark are carried over automatically on the same browser origin.

![Threadline demo showing grouped tasks, dependency links, confidence colors, and the plan summary](docs/threadline-demo.png)

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

## GitHub Pages

The **Tests** workflow runs tests and a production build on pushes to `main` and on pull requests. The **Deploy GitHub Pages** workflow tests, builds with relative asset paths, and publishes the static app on pushes to `main` (or when manually run).

To enable deployment, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** in the repository. After a successful deployment, open **https://link-.github.io/threadline/**. Plans still live only in your browser's storage; this URL has separate storage from the local and Docker URLs.

## License

Copyright (c) 2026 Link-. All rights reserved. This project is proprietary; see [LICENSE](LICENSE) for restrictions on copying and redistribution.
