# 75 Hard Tracker

A tiny, no-build web app for logging the 75 Hard challenge, one journal page per day. Each save is committed to a **private** GitHub repo.

- Daily checklist: diet, no alcohol or cheat meals, two 45-minute workouts, 1 gallon of water, progress photo, 10 pages of reading
- Meals (pre-filled with fasting and non-fasting templates), water counter, outside and inside workouts (a note + done each; training detail lives in Calisteniapp, Strava rides can be added with `tools/log-ride.mjs`), sleep, mood, weight, reading reflection, notes, progress photo, Sunday measurements
- Progress view: a 75-day grid, weight trend, measurements table
- Works offline. Changes are saved on the device and pushed when you're back online.

## How it stores data
Everything goes to a separate private repo (default `75-hard-data`) using the GitHub REST API:

```
data.json            all days (used to sync phone and laptop)
days/YYYY-MM-DD.md   readable journal page for each day
photos/YYYY-MM-DD.jpg
README.md            progress table
```

The app needs a **fine-grained personal access token** with **Contents: Read and write** on the data repo only. The token stays in the browser's local storage on each device and is never committed.

## Run locally
Open `index.html` through any static server, for example `npx serve .`. It's also hosted on GitHub Pages.
