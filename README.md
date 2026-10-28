# Plants Tracker

A small PWA that tells our household when to water the houseplants. Add your plants with a photo and a watering interval, share your home with a link, and get a notification on the days a plant needs water.

**Live:** https://plants-tracker.pages.dev/

<!-- Add a screenshot here, for example: ![Dashboard](docs/screenshot.png) -->

## Features

- Plants with a photo, room, nickname, notes and watering interval; one tap marks a plant as watered
- Shared homes: anyone with the invite link joins the same home, no account or password needed
- A daily push notification when plants are due
- A household profile (pets, small kids, light, care commitment) in Settings
- Installable on phone and desktop
- Photos compressed in the browser before upload

## Stack

- SvelteKit (Svelte 5) and TypeScript, deployed on Cloudflare Pages
- Turso (libSQL) for data, Cloudflare R2 for photos
- Web Push with VAPID keys, signed with the Web Crypto API, since the usual `web-push` package does not run on Workers
- One JWT per home in an HttpOnly cookie (`jose`), plus join tokens for invites
- A scheduler outside this repo POSTs to `/api/cron/water-check` once a day with an `x-cron-secret` header to send the reminders

## Run it locally

Requires Node 24 (see `.nvmrc`) and pnpm.

1. Install dependencies: `pnpm install`
2. Copy `.env.example` to `.env.develop` and fill it in. `pnpm dev` runs in `develop` mode, so it reads `.env.develop`, not `.env`.
   - `TURSO_URL`, `TURSO_AUTH_TOKEN`: a Turso database, or a local one such as `turso dev` (`http://localhost:8080`)
   - `JWT_SECRET`: any long random string
   - `PUBLIC_APP_URL`, `PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (a `mailto:` address)
   - `VAPID_KEYS`: the key pair as JSON, see below
   - `CRON_SECRET`: any random string
3. Create the tables: `pnpm db:migrate`
4. Optionally load the plant catalog: `pnpm db:seed`
5. Start the dev server: `pnpm dev`

### VAPID keys

The app reads the key pair from a single `VAPID_KEYS` variable holding the JSON export of the keys, not from separate public and private variables. Generate it with the library the app uses:

```sh
node --input-type=module -e "
import { generateVapidKeys, exportVapidKeys, exportApplicationServerKey } from '@negrel/webpush';
const keys = await generateVapidKeys({ extractable: true });
console.log(JSON.stringify(await exportVapidKeys(keys)));
console.error('PUBLIC_VAPID_PUBLIC_KEY=' + await exportApplicationServerKey(keys));
"
```

Put the JSON line in `VAPID_KEYS` and the second value in `PUBLIC_VAPID_PUBLIC_KEY`.

## Database migrations

Migrations are not applied on deploy. They live in `src/lib/server/migrate.ts` and run only when you call them. To migrate production, run this before deploying any change that adds a migration:

```sh
TURSO_URL='libsql://…' TURSO_AUTH_TOKEN='…' node scripts/migrate.ts
```

Migrations are additive and recorded in the `_migrations` table, so a failed run can be repeated. Cloudflare secrets can't be read back, so get the production URL and a token from `turso db show <name> --url` and `turso db tokens create <name>`.

## Deploy

The app runs on Cloudflare Pages. Build and upload:

```sh
pnpm build
wrangler pages deploy .svelte-kit/cloudflare --branch=main
```

Wrangler takes the branch name from git. Any branch other than the project's production branch (`main`) produces a preview deployment, which has its own secrets and bindings, so pass `--branch=main` when deploying from a worktree.

Set these as secrets in the Pages project, for Production and for Preview if you use previews:

`TURSO_URL`, `TURSO_AUTH_TOKEN`, `VAPID_KEYS`, `VAPID_SUBJECT`, `JWT_SECRET`, `CRON_SECRET`, `PUBLIC_VAPID_PUBLIC_KEY`, `PUBLIC_APP_URL`

Bind the R2 bucket `plant-tracker-images` as `PLANT_IMAGES` (see `wrangler.toml`).
