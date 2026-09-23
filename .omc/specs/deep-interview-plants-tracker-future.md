# Deep Interview Spec: Plants Tracker — Future Development

## Metadata

- Interview ID: plants-tracker-future-001
- Rounds: 16 (Rounds 1–9 in session 82df373f, Rounds 10–16 resumed in session 2b6791c6)
- Final Ambiguity Score: 18%
- Type: brownfield
- Generated: 2026-06-29
- Threshold: 20%
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

---

## Clarity Breakdown

| Dimension          | Score | Weight | Weighted  |
| ------------------ | ----- | ------ | --------- |
| Goal Clarity       | 0.86  | 35%    | 0.301     |
| Constraint Clarity | 0.82  | 25%    | 0.205     |
| Success Criteria   | 0.79  | 25%    | 0.198     |
| Context Clarity    | 0.78  | 15%    | 0.117     |
| **Total Clarity**  |       |        | **0.821** |
| **Ambiguity**      |       |        | **18%**   |

---

## Topology

| Component             | Status | Description                                                                                                          | Coverage                                                                                    |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Watering History      | active | `plant_care_events` table tracking each care event; enables undo mis-click, per-plant history view, future analytics | Ship #1. Done: user taps a plant, sees log, deletes any past entry.                         |
| Plant Intelligence    | active | Species lookup via Perenual API + DB cache; default watering schedules pre-filled on plant creation                  | Ship #2. Done: user types name, picks species, schedule pre-filled.                         |
| Members / Identity    | active | Minimal identity layer with recovery token; no mandatory login                                                       | Ship #3. Done: user gets recovery token on first visit, restores garden on new device.      |
| Notification UX       | active | Per-device notification timing + mark-all-watered action in push                                                     | Ship #4. Done: user sets preferred time per device, can mark all watered from notification. |
| Multi-home / Space UX | active | Space-switching UI (schema already ready) + invite revocation/rotation                                               | Ship #5. Done: user switches between spaces, manages invite links.                          |
| Offline / Resilience  | active | Offline write queue for "mark as watered" with no internet                                                           | Lowest priority. Assess cheap foundational steps; SW already caches reads.                  |

---

## Goal

Extend Plants Tracker — a deployed PWA (SvelteKit/Svelte 5, Cloudflare Pages, Turso SQLite) — with five features in priority order, making all data model decisions upfront to avoid future migrations. The schema work happens now; UI polish happens after the co-designer (wife, graphic designer) reviews the feature list and flows.

---

## Constraints

- **No mandatory login.** Users must never be forced to create an account. Identity is opt-in recovery only.
- **Schema stability first.** Every data model decision is made before the first feature ships to avoid future migrations on a live dataset.
- **Cloudflare/Turso architecture.** All features must work within Cloudflare Pages + Workers + Turso SQLite constraints (no persistent server, D1-style edge SQL).
- **Perenual API.** Free tier = 100 requests/day. API is the primary source; `plant_species` table is the cache. Rate limit must be respected (cache hits reduce API calls; on miss, call API and cache result).
- **Freemium model (future).** A `members.tier` column will eventually enforce plant count limits and dashboard access restrictions. Schema must accommodate this; enforcement is deferred.
- **Offline writes are deferred.** The service worker already caches reads (`/api/plants` stale-while-revalidate). Offline writes (mark-as-watered queue) are significant engineering; deferred until after core features ship.
- **Presentation gate.** No UI/UX decisions are final until the co-designer reviews the feature list and flows. The spec feeds a non-technical presentation; visual design follows.

---

## Non-Goals

- Onboarding polish — deferred until core features are tested and working
- Health dashboards UI — data model supports it (`plant_care_events.notes`), dashboard view deferred
- Monetization enforcement — freemium concept confirmed, schema accommodated, enforcement deferred
- Plant sharing / social features — not in scope
- Full offline support (write queue) — deferred; reads already work offline via SW cache
- Mandatory login or OAuth — explicitly out of scope

---

## Acceptance Criteria

### Watering History (#1)

- [ ] A `plant_care_events` table exists with columns: `id, plant_id, home_id, care_type ENUM('water','fertilize','repot','other'), performed_at DATETIME, notes TEXT (nullable)`
- [ ] `plants.last_watered_at` column is removed; dashboard derives last watered from `plant_care_events` via JOIN
- [ ] `plants.next_watering_date` is retained as a precomputed column (cron query performance)
- [ ] Marking a plant as watered inserts a row into `plant_care_events` instead of updating `plants.last_watered_at`
- [ ] Plant detail view shows a chronological list of past care events
- [ ] Each care event row has a delete button; deletion is a hard delete (no soft-delete)
- [ ] Deleting an event recalculates `next_watering_date` for the plant

### Plant Intelligence (#2)

- [ ] A `plant_species` table exists: `id, common_name, scientific_name, watering_interval_days INT, care_tips TEXT (nullable), source ENUM('seed','api'), last_fetched_at DATETIME`
- [ ] `plants.species_id` column added as a nullable FK to `plant_species.id`
- [ ] Plant creation form includes a species search field with autocomplete
- [ ] On search, the app queries `plant_species` first; on miss, calls Perenual API, caches result, returns it
- [ ] Selecting a species pre-fills the watering interval field (user can override)
- [ ] Species FK on plant is optional — plants without a matched species still work normally
- [ ] Perenual API key is stored in environment config (not hardcoded)

### Members / Identity (#3)

- [ ] A `members` table exists: `id, recovery_token_hash TEXT, email TEXT (nullable), created_at DATETIME`
- [ ] On first app visit, a `member` record is created and a recovery token is generated (shown once, copyable/QR)
- [ ] `push_subscriptions` table has a `member_id FK → members.id`
- [ ] `notification_preferences` table has a `member_id FK → members.id`
- [ ] User can optionally add an email for recovery backup (stored hashed or as plaintext with consent — TBD)
- [ ] Recovery flow: user enters token on new device → their spaces and notification preferences are restored
- [ ] A `members.tier` column exists (default: 'free') for future monetization enforcement

### Notification UX (#4)

- [ ] `notification_preferences` table exists: `id, member_id FK, preferred_hour INT, preferred_minute INT, timezone TEXT, enabled BOOL`
- [ ] Settings page allows user to set their preferred notification time
- [ ] Push notifications are sent at the user's preferred time (cron checks `notification_preferences`)
- [ ] Push notification payload includes a "Mark all watered" action button
- [ ] Tapping "Mark all watered" in the notification marks all due plants as watered (inserts into `plant_care_events`)
- [ ] Notification preference is per-member (syncs across devices signed in as the same member)

### Multi-home / Space UX (#5)

- [ ] "Home" is renamed to "Space" in all UI labels (DB column `name` already holds the user-chosen label)
- [ ] A Space switcher is accessible from the main nav/header
- [ ] User can revoke an invite link (generates a new token, old token stops working)
- [ ] User can rotate an invite link (revoke + new link in one action)
- [ ] Each space's plant list is isolated; switching spaces changes the dashboard context

### Offline / Resilience (foundation — low priority)

- [ ] Audit current SW (`src/service-worker.ts`) and document which routes are cached and which fail offline
- [ ] Identify the minimal schema/queue shape for offline write support (write-ahead queue design doc) — implementation deferred

---

## Schema Summary (all changes)

```sql
-- NEW: care events (replaces last_watered_at)
CREATE TABLE plant_care_events (
  id          TEXT PRIMARY KEY,
  plant_id    TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  home_id     TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  care_type   TEXT NOT NULL CHECK(care_type IN ('water','fertilize','repot','other')),
  performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes       TEXT
);

-- NEW: species catalog + API cache
CREATE TABLE plant_species (
  id                    TEXT PRIMARY KEY,
  common_name           TEXT NOT NULL,
  scientific_name       TEXT,
  watering_interval_days INT,
  care_tips             TEXT,
  source                TEXT NOT NULL CHECK(source IN ('seed','api')),
  last_fetched_at       DATETIME
);

-- NEW: identity layer
CREATE TABLE members (
  id                   TEXT PRIMARY KEY,
  recovery_token_hash  TEXT NOT NULL UNIQUE,
  email                TEXT,
  tier                 TEXT NOT NULL DEFAULT 'free',
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NEW: per-member notification preferences
CREATE TABLE notification_preferences (
  id               TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  preferred_hour   INT NOT NULL DEFAULT 8,
  preferred_minute INT NOT NULL DEFAULT 0,
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  enabled          BOOL NOT NULL DEFAULT TRUE
);

-- MODIFY: plants — add species FK, remove last_watered_at
ALTER TABLE plants ADD COLUMN species_id TEXT REFERENCES plant_species(id);
ALTER TABLE plants DROP COLUMN last_watered_at;
-- next_watering_date is RETAINED

-- MODIFY: push_subscriptions — add member FK
ALTER TABLE push_subscriptions ADD COLUMN member_id TEXT REFERENCES members(id);
```

---

## Assumptions Exposed & Resolved

| Assumption                        | Challenge                                                               | Resolution                                                      |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| "Home" is the right term          | Public users may have multiple locations, offices, etc.                 | Renamed to "Space" — UI label only, `name` column unchanged     |
| Watering-only events table        | User mentioned fertilizing, health state over time                      | General `plant_care_events` with `care_type` enum               |
| Fixed cron for notifications      | Evening vs morning timing; whose preference wins?                       | Per-member preferred time; cron uses `notification_preferences` |
| No user concept needed            | Notification prefs must attach to something; recovery requires identity | Minimal `members` table with recovery token, no mandatory login |
| Plant count has no upper bound    | Freemium model discussed                                                | `members.tier` column deferred but schema-ready                 |
| Last watered is a scalar          | Undo requires history; analytics require event log                      | `plant_care_events` table; `last_watered_at` removed            |
| Undo = time-limited (like Gmail)  | Does a countdown add friction for plant watering?                       | Any-time undo — hard delete any past event                      |
| API-backed species from the start | Could seed manually to avoid API dependency                             | API-first (Perenual) accepted; 100 req/day free tier sufficient |

---

## Technical Context

**Stack:** SvelteKit/Svelte 5, Cloudflare Pages + Workers, Turso SQLite, R2 (photos), Web Push VAPID

**Key existing files:**

- `src/lib/server/queries/plants.ts:128-143` — current `mark as watered` logic (updates `last_watered_at`); needs to be replaced with `plant_care_events` INSERT
- `src/lib/server/queries/plants.ts:127` — existing TODO: _"possibly pass date as param, so we can undo watering or set a specific date"_ — now resolved by the events table
- `src/service-worker.ts` — already does stale-while-revalidate for `/api/plants`; push subscription handling
- `src/lib/server/platform.ts` — Cloudflare env/platform bindings
- `src/lib/server/db.ts` — Turso client
- `src/lib/server/migrate.ts` — migration runner

**Migration strategy:** All schema changes above run via the existing migration system. `last_watered_at` removal requires a data migration: backfill `plant_care_events` from current `last_watered_at` values before dropping the column.

---

## Ship Order & "Done" Definitions

| #   | Feature               | Done When                                                                                                   |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Watering History      | User taps a plant → sees chronological care log → can delete any past entry                                 |
| 2   | Plant Intelligence    | User types a plant name → picks from species suggestions → watering schedule pre-filled                     |
| 3   | Members / Identity    | User gets recovery token on first visit → can enter token on new device → garden restored                   |
| 4   | Notification UX       | User sets preferred notification time → receives push at that time → can mark all watered from notification |
| 5   | Multi-home / Space UX | User can switch between spaces from nav → can revoke/rotate invite links                                    |
| —   | Offline Resilience    | Foundational audit + write-queue design doc (full implementation deferred)                                  |

---

## Presentation Notes (for non-technical audience)

This spec feeds a product walkthrough for the graphic designer co-owner. Key points for the presentation:

1. **The app is live** — MVP with plants, photos, watering tracking, and push notifications is deployed
2. **Next 5 features** (in order) with user-visible outcomes per the "Done" definitions above
3. **No logins** — users get a recovery code instead; the app feels personal without an account wall
4. **Smart plant assistant** — type a plant name and the app knows how often to water it
5. **Spaces** — designed for people with multiple locations (apartment + dacha, home + office)
6. **UI/UX is not finalized** — all visual design and user flows are open for co-designer input

---

## Ontology (Key Entities)

| Entity                 | Type        | Fields                                                                        | Relationships                                                       |
| ---------------------- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Plant                  | core domain | id, home_id, species_id (nullable), name, room, next_watering_date, photo_url | belongs to Space; has many CareEvents; optionally linked to Species |
| Space (Home)           | core domain | id, name, invite_token                                                        | has many Plants; has many Members (via membership)                  |
| CareEvent              | core domain | id, plant_id, home_id, care_type, performed_at, notes                         | belongs to Plant; belongs to Space                                  |
| Member                 | core domain | id, recovery_token_hash, email (nullable), tier                               | has one NotificationPreference; has many PushSubscriptions          |
| Species                | supporting  | id, common_name, scientific_name, watering_interval_days, care_tips, source   | optionally referenced by many Plants                                |
| PushSubscription       | supporting  | id, member_id, endpoint, keys                                                 | belongs to Member                                                   |
| NotificationPreference | supporting  | id, member_id, preferred_hour, preferred_minute, timezone, enabled            | belongs to Member                                                   |

---

## Interview Transcript Summary

<details>
<summary>Q&A across 16 rounds (2 sessions)</summary>

**R0:** Topology confirmed — 5 active components added (Watering History added by user; offline moved to lowest priority)

**R1:** Watering History → general care events table (`plant_care_events`), not watering-only; `last_watered_at` to be removed

**R2:** Plant Intelligence → write-through cache pattern; seed + external API on miss

**R3:** Offline/Resilience → SW already caches reads; offline writes = deferred; user building for real public users

**R4:** Notification UX → flexible per-device scheduling (not fixed cron); snooze-to-later queue noted; evening reminders confirmed useful despite contrarian challenge

**R5:** Multi-home → renamed "Space"; schema already supports it; invite revocation needed

**R6:** Watering History criteria → simplest useful version = events table + undo; `last_watered_at` dropped; `next_watering_date` stays; SW caching makes JOIN cost negligible

**R7:** Plant Intelligence schema → nullable `species_id` FK; analytics-ready without forced mapping

**R8:** Notification UX constraints (Ontologist) → surfaced missing "member" entity; preferences must attach to member, not device

**R9:** Identity model → hybrid recovery: token once (copyable/QR) + optional email; minimal `members` table; `push_subscriptions` + `notification_preferences` both FK to `member_id`

**R10:** Missing features → onboarding deferred; health dashboard UI deferred but `notes` field added; monetization = freemium (plant count + dashboard limits), `members.tier` for future; no schema blocker now

**R11:** Ship order #1 → Watering History

**R12:** Undo mechanic → any-time, any past event, hard delete

**R13:** Context → co-developing with wife (graphic designer); presentation needed before UI decisions; ship #2 = Plant Intelligence

**R14:** Plant Intelligence criteria → API-first from day one (not manually seeded)

**R15:** Final ship order → Watering History → Plant Intelligence → Members → Notification UX → Multi-home

**R16:** Plant API → Perenual (100 req/day free tier, watering data included)

</details>
