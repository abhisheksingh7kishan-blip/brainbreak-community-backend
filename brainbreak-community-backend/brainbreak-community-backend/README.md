# BrainBreak Community World Backend

A complete, ready-to-deploy Vercel backend for every online Community World
feature built so far: creator profiles, level publish/unpublish, Discover
(browse/search), likes, favorites, plays, leaderboards (5 independent
categories), and achievements. Nothing here needs an existing backend —
this is the whole thing, from zero.

## What's in here

```
api/
  _lib/
    supabaseClients.js         <- the auth split every endpoint relies on
    syncAchievements.js
  health.js                     <- GET, sanity-check after deploying
  cron/
    refresh-leaderboard.js      <- scheduled, keeps rankings up to date
  community/
    profile/
      me.js                     <- GET/PATCH your own profile
    publish.js                  <- POST, create/update/publish a level
    creators/
      [...path].js              <- dispatcher: leaderboard, [id], [id]/levels,
                                    [id]/achievements, me/levels
    interactions/
      [...path].js              <- dispatcher: like, favorite, play
    levels/
      [...path].js              <- dispatcher: [id], [id]/play-data,
                                    discover, report, unpublish
  admin/
    [...path].js                <- dispatcher: reports/list, reports/review
src/
  controllers/
    creators.js                 <- business logic for the creators dispatcher
    interactions.js             <- business logic for the interactions dispatcher
    levels.js                   <- business logic for the levels dispatcher
    admin.js                    <- business logic for the admin dispatcher
sql/
  1_community_creator_leaderboards.sql
  2_community_creator_system_api.sql
  3_community_creator_discover.sql
  4_community_moderation_cooldown_rank.sql
public/
  index.html                    <- status page at the root URL (no function used)
  admin.html                    <- standalone moderation page (not part of the game)
test/
  dispatch.test.mjs             <- offline regression test for every route
  mocks/supabase-js-stub.mjs    <- test-only fake, never used in production
vercel.json                     <- schedules the leaderboard refresh
package.json
.env.example
```

You should already have `community_world.sql` (profiles/levels/likes/
favorites/plays base schema) run in Supabase from earlier — the 4 files in
`sql/` here are additive on top of that, **run them in the numbered order**.

### Why `[...path].js` files, and why there are only 8 functions

Vercel Hobby caps a deployment at **12 Serverless Functions**. This project
has 19 API routes, so four of the busiest folders (`creators`,
`interactions`, `levels`, `admin`) are each served by a single Vercel
"catch-all" function (`[...path].js`) that reads the URL's remaining path
segments and the HTTP method, then calls the matching function in
`src/controllers/`. Every external URL, HTTP method, auth check, and JSON
response is unchanged from before — only the internal file that answers
the request changed. `profile/me.js`, `publish.js`, `health.js`, and
`cron/refresh-leaderboard.js` only ever had one route each, so they were
left exactly as they were.

**Final count: 8 Serverless Functions** (well under the 12 limit):
`health.js`, `cron/refresh-leaderboard.js`, `community/profile/me.js`,
`community/publish.js`, `community/creators/[...path].js`,
`community/interactions/[...path].js`, `community/levels/[...path].js`,
`admin/[...path].js`. Everything in `api/_lib/` and `src/` is a plain
JS module, not a function — Vercel only turns files directly under `api/`
into functions.

---

## Setup, start to finish

### 1. Put this code on GitHub
If you don't already have a repo for this: on **github.com**, tap **+ →
New repository**, give it a name, create it, then use **"Add file → Upload
files"** (works fine on mobile) to upload every file above, keeping the
exact same folder structure (including files literally named `[...path].js`
and `me.js` inside `profile/` — type the brackets and dots literally,
GitHub handles them fine). Make sure `src/` and `public/index.html` get
uploaded too, not just `api/` — the dispatcher functions import from
`src/`, and the root URL needs `public/index.html` to stop 404ing.

### 2. Run the 4 SQL files in Supabase
Supabase → your project → **SQL Editor** → **+ New query** → paste →
**Run**, one at a time, in this order:
1. `sql/1_community_creator_leaderboards.sql`
2. `sql/2_community_creator_system_api.sql`
3. `sql/3_community_creator_discover.sql`
4. `sql/4_community_moderation_cooldown_rank.sql`

(Skip this step for any file you already ran in an earlier session.)

### 3. Enable Anonymous sign-ins
Supabase → **Authentication** → **Providers** → find **Anonymous** → turn
it **on**. This is what lets the game create a player identity without a
signup screen.

### 3b. Set yourself up as moderator (one-time)
Players stay fully anonymous — this step is only for you.
1. Supabase → **Authentication** → **Providers** → **Email** → turn it **on**
2. Supabase → **Authentication** → **Users** → **Add user** → give yourself a real email + password
3. Copy that new user's UUID (shown in the users list)
4. SQL Editor → run:
   ```sql
   update public.profiles set role = 'admin' where id = 'PASTE-YOUR-USER-UUID-HERE';
   ```
This is what lets `public/admin.html` (step 9 below) let you in.

### 4. Create the Vercel project
1. Go to **vercel.com**, log in
2. Tap **Add New… → Project**
3. Tap **Import Git Repository**, find the repo from step 1, tap **Import**
4. Leave the build settings as default (no framework, it's plain Vercel
   Functions) and tap **Deploy**. It will likely fail once — that's
   expected, because the environment variables aren't set yet. Continue
   to step 5.

### 5. Add environment variables
Vercel → your new project → **Settings → Environment Variables**. Add
these three (values from Supabase → Project Settings → API), ticking
Production/Preview/Development for each:

| Key | Value |
|---|---|
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_ANON_KEY` | your anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | your service_role key (keep secret) |

You do **not** need to add `CRON_SECRET` yourself — Vercel provisions that
one automatically once it sees the `crons` entry in `vercel.json`.

### 6. Redeploy
Vercel → **Deployments** tab → tap **⋮** on the latest one → **Redeploy**.

### 7. Check it worked
Open, in your phone browser, just the root URL:
```
https://your-project.vercel.app/
```
This loads `public/index.html`, a small status page that calls
`/api/health` for you and shows **"All systems operational"** in green
once Supabase and every env var are reachable — no more blank 404 at the
root. If anything's off, it turns red and shows which check failed
(database unreachable, or a specific env var missing) plus the raw error
text from Supabase. It auto-refreshes every 30 seconds, or tap **Refresh**.

(The raw JSON is still available directly at `/api/health` if you want it
— same endpoint as before, unchanged.)

If `database` shows red, re-check the 4 SQL files ran without error, in
order. If an env var shows red, re-check that exact variable name in step
5 (typos are the #1 cause).

### 8. Point the game at this backend
The game is packaged inside your Android app (Play Store), not served from
this Vercel URL — so it needs the FULL backend URL, not a relative path.
In `brainbreak.html`, find and fill in all three (same values as step 5's
first two, plus your Vercel domain):
```js
const CW_SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const CW_SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
const CW_API_BASE = 'https://your-project.vercel.app'; // no trailing slash
```
Every `fetch()` call in the client already goes through a `cwApi(path)`
helper that prepends `CW_API_BASE` — filling in that one constant is all
that's needed; no other client code changes.

**Why this matters (CORS):** your app and this API are different origins
from the WebView's point of view, so every API response needs
cross-origin headers or the request gets silently blocked before your code
ever sees a response. Every endpoint in this backend already sends
`Access-Control-Allow-Origin: *` (see `handleCors()` in
`api/_lib/supabaseClients.js`) — nothing more to configure here, but if
you ever add a new endpoint file yourself, copy that same first line from
any existing handler.

Rebuild/re-export your Android app with the updated `brainbreak.html` and
publish the update however you normally do (Play Console).

### 9. Set up the moderation page
`public/admin.html` also needs the same two values filled in (`SUPABASE_URL`
/ `SUPABASE_ANON_KEY`, same as step 8). Once deployed, visit
`https://your-project.vercel.app/admin.html`, sign in with the email/
password from step 3b, and you'll see any pending reports with **Remove
Level** / **Dismiss** buttons. This page is separate from the game —
players never see or reach it.

---

## Feature → endpoint map

| Feature | Endpoint |
|---|---|
| Choose/change display name | `PATCH /api/community/profile/me` |
| View own profile | `GET /api/community/profile/me` |
| Publish / update / republish a level | `POST /api/community/publish` |
| Unpublish a level | `POST /api/community/levels/unpublish` |
| View a level (+ creator name) | `GET /api/community/levels/[id]` |
| Discover / search levels | `GET /api/community/levels/discover?category=recent\|most_played\|most_liked\|complex` |
| Load a level to actually play it | `GET /api/community/levels/[id]/play-data` |
| My Levels (any status) | `GET /api/community/creators/me/levels` |
| Another creator's levels | `GET /api/community/creators/[id]/levels` |
| Public creator profile | `GET /api/community/creators/[id]` |
| Creator achievements | `GET /api/community/creators/[id]/achievements` |
| Worldwide Creators leaderboard | `GET /api/community/creators/leaderboard?category=` |
| Like / unlike | `POST /api/community/interactions/like` |
| Favorite / unfavorite | `POST /api/community/interactions/favorite` |
| Register a play | `POST /api/community/interactions/play` |
| Report a level | `POST /api/community/levels/report` |
| Review reports (admin) | `GET /api/admin/reports/list`, `POST /api/admin/reports/review` |

Every endpoint that changes something on behalf of a player requires the
`Authorization: Bearer <token>` header the client's `COMMUNITY_AUTH` module
already attaches automatically — nothing extra to build there.

## Previously-flagged gaps — now built
- **Level removal/moderation** — players can report a level (`report.js`);
  `public/admin.html` lets an admin (role='admin' profile) review pending
  reports and remove a level or dismiss the report. `remove_level()` sets
  `status = 'removed'` — never a delete.
- **Per-user play cooldown** — `register_level_play()` (SQL file 4) now
  silently skips counting a play if the same player played the same level
  within the last 30 seconds. Not an error to the player — the level still
  loads and plays normally, it's just not double-counted.
- **Exact leaderboard rank** — `get_creator_rank()` (SQL file 4) returns a
  creator's exact position in one category, embedded into
  `get_creator_profile()`'s response as `rank.rank`. "Your Stats" now shows
  `#127` instead of "Unranked" once a creator actually has one.

## What's intentionally still not built
- **Rank in categories other than Most Played** — `get_creator_rank()`
  supports any category via its `p_category` argument, but "Your Stats"
  only calls it for `most_played` right now. Say the word to show all 5.
- **Report reasons beyond the fixed 5** (`broken`/`inappropriate`/`spam`/
  `exploit`/`other`) — matches `public.report_reason`'s enum; adding a new
  reason means an additive enum value plus one line in `report.js`.
