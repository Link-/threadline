# Threadline

A private, local Gantt chart creator. Plans and tasks live in this browser's `localStorage`; there is no account, backend, or network service required by the app. Use **Save locally** to download the active plan as a `.threadline.json` file, then **Import plan** to add it back as a new plan. Existing plans saved as Daymark are carried over automatically on the same browser origin.

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
