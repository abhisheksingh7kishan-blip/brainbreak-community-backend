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
    supabaseClients.js     <- the auth split every endpoint relies on
    syncAchievements.js
  community/
    publish.js             <- POST, create/update/publish a level
    levels/
      [id].js               <- GET one level (+ creator info)
      [id]/play-data.js      <- GET full playable geometry for PLAY
      discover.js           <- GET browse/search published levels (4 categories)
      unpublish.js          <- POST take a level down
    profile/
      me.js                 <- GET/PATCH your own profile
    creators/
      leaderboard.js        <- GET ranked creators, by category
      [id].js               <- GET one creator's public profile
      [id]/levels.js         <- GET another creator's published levels
      [id]/achievements.js   <- GET a creator's badges
      me/levels.js           <- GET your own levels (any status)
    interactions/
      like.js / favorite.js / play.js
  cron/
    refresh-leaderboard.js  <- scheduled, keeps rankings up to date
  health.js                 <- GET, sanity-check after deploying
sql/
  1_community_creator_leaderboards.sql
  2_community_creator_system_api.sql
  3_community_creator_discover.sql
  4_community_moderation_cooldown_rank.sql
api/
  admin/reports/
    list.js                 <- GET pending reports (admin only)
    review.js                <- POST remove level / dismiss (admin only)
  community/levels/
    report.js                <- POST, any player reports a level
public/
  admin.html                 <- standalone moderation page (not part of the game)
vercel.json                 <- schedules the leaderboard refresh
package.json
.env.example
```

You should already have `community_world.sql` (profiles/levels/likes/
favorites/plays base schema) run in Supabase from earlier — the 3 files in
`sql/` here are additive on top of that, **run them in the numbered order**.

---

## Setup, start to finish

### 1. Put this code on GitHub
If you don't already have a repo for this: on **github.com**, tap **+ →
New repository**, give it a name, create it, then use **"Add file → Upload
files"** (works fine on mobile) to upload every file above, keeping the
exact same folder structure (including the `[id]` and `[id].js` names —
type the brackets literally, GitHub handles them fine).

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
Open, in your phone browser:
```
https://your-project.vercel.app/api/health
```
You should see `"ok": true` with every field green/true. If `dbOk` is
false, re-check the 3 SQL files ran without error. If any `env` field is
false, re-check that exact variable name in step 5 (typos are the #1
cause).

### 8. Point the game at this backend
In `brainbreak.html`, fill in (same values as step 5's first two rows):
```js
const CW_SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const CW_SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```
The game calls relative paths like `/api/community/publish` — as long as
`brainbreak.html` is served **from this same Vercel project** (e.g. you
put it at the project root, or in a `public/` folder Vercel serves as
static files), those calls resolve automatically. If the game is hosted
somewhere else entirely, every `fetch('/api/...')` call in the client
needs to become `fetch('https://your-project.vercel.app/api/...')`
instead — say the word if that's your setup and I'll make that change.

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
