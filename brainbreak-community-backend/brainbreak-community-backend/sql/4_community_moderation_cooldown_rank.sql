-- ============================================================================
-- COMMUNITY WORLD — MODERATION, PLAY COOLDOWN, EXACT RANK (ADDITIVE MIGRATION)
-- ============================================================================
-- Safe to run after files 1-3. Addresses the 3 previously-flagged gaps:
--   A. Level removal/moderation (admin-only, built on the level_reports
--      table + profiles.role that community_world.sql already reserved
--      for exactly this)
--   B. Per-user play-spam cooldown (redefines register_level_play() with
--      the same signature — safe, no data loss, just adds a check)
--   C. Exact leaderboard rank number (new function, plus get_creator_profile()
--      redefined to include it)
-- ============================================================================


-- ============================================================================
-- A. LEVEL REMOVAL / MODERATION
-- ============================================================================
-- Mirrors publish_level()/unpublish_level()'s own bypass pattern exactly
-- (see levels_guard_update's comment in community_world.sql) — this is the
-- remove_level() that guard trigger's error message already referenced.
-- Callable by: an authenticated user whose OWN profile has role='admin',
-- OR a service-role connection (the trusted Vercel backend acting on a
-- reviewed report) — never by an ordinary player, and never based on
-- anything the client claims about itself.
create or replace function public.remove_level(p_level_id uuid, p_reason text default null)
returns public.levels
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privileged boolean;
  v_level public.levels;
begin
  v_privileged := (coalesce(auth.role(), '') = 'service_role')
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');

  if not v_privileged then
    raise exception 'admin privileges required';
  end if;

  perform set_config('app.bypass_level_guard', 'true', true);
  update public.levels set status = 'removed' where id = p_level_id returning * into v_level;

  if not found then
    raise exception 'level not found';
  end if;
  return v_level;
end;
$$;

comment on function public.remove_level is
  'Admin-only takedown. Reason is for the audit trail (see level_reports), not stored redundantly on the level itself. A removed level keeps its id/data — this is not a delete.';

grant execute on function public.remove_level(uuid, text) to authenticated;


-- ============================================================================
-- B. PER-USER PLAY-SPAM COOLDOWN
-- ============================================================================
-- One row per (level, player) tracking the last COUNTED play. A play
-- attempt inside the cooldown window still "works" from the player's
-- perspective (the level loads and plays normally) — it's simply not
-- counted again, silently, so a modified/rapid client gains nothing by
-- spamming this endpoint instead of getting an error to work around.
create table if not exists public.level_play_cooldowns (
  level_id uuid not null references public.levels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_played_at timestamptz not null default now(),
  primary key (level_id, user_id)
);

create index if not exists idx_level_play_cooldowns_user on public.level_play_cooldowns (user_id);

comment on table public.level_play_cooldowns is
  'Anti-spam only — not a play history/log. One row per (level, player), overwritten on every counted play.';

-- Same name/signature as community_world.sql's original — safe to
-- redefine; no data is dropped, only the function body changes.
create or replace function public.register_level_play(p_level_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.level_status;
  v_last timestamptz;
  v_cooldown interval := interval '30 seconds';
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select status into v_status from public.levels where id = p_level_id;
  if not found then
    raise exception 'level not found';
  end if;
  if v_status <> 'published' then
    raise exception 'only published levels can be played';
  end if;

  select last_played_at into v_last
    from public.level_play_cooldowns
    where level_id = p_level_id and user_id = auth.uid();

  if v_last is not null and v_last > now() - v_cooldown then
    return; -- within cooldown: not an error, just not counted again
  end if;

  insert into public.level_play_cooldowns (level_id, user_id, last_played_at)
    values (p_level_id, auth.uid(), now())
    on conflict (level_id, user_id) do update set last_played_at = excluded.last_played_at;

  perform set_config('app.bypass_level_guard', 'true', true);
  update public.levels set play_count = play_count + 1 where id = p_level_id;

  insert into public.level_play_stats_daily (level_id, play_date, plays)
  values (p_level_id, current_date, 1)
  on conflict (level_id, play_date) do update
    set plays = public.level_play_stats_daily.plays + 1;
end;
$$;

comment on function public.register_level_play is
  '30-second minimum gap between COUNTED plays of the same level by the same player. Adjust the v_cooldown constant if that turns out too strict/loose in practice.';

grant select, insert, update on public.level_play_cooldowns to authenticated; -- table is only ever touched from inside this SECURITY DEFINER function, but PostgREST/RLS still needs a grant to exist; RLS below is what actually restricts it
alter table public.level_play_cooldowns enable row level security;
drop policy if exists level_play_cooldowns_none on public.level_play_cooldowns;
create policy level_play_cooldowns_none on public.level_play_cooldowns for all using (false) with check (false);
-- The policy above blocks ALL direct client access (select/insert/update)
-- even though a grant exists — every real read/write happens inside
-- register_level_play(), which runs as the function OWNER and therefore
-- bypasses RLS entirely (the normal, correct way to let a SECURITY
-- DEFINER function manage a table that clients must never touch directly).


-- ============================================================================
-- C. EXACT LEADERBOARD RANK
-- ============================================================================
create or replace function public.get_creator_rank(
  p_creator_id uuid,
  p_category text default 'most_played'
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order_col text;
  v_total bigint;
  v_rank bigint;
  v_value bigint;
begin
  v_order_col := case p_category
    when 'most_played'    then 'total_plays'
    when 'most_liked'     then 'total_likes'
    when 'most_published' then 'total_published'
    when 'most_favorited' then 'total_favorites'
    when 'popular_levels' then 'popular_level_score'
    else null
  end;
  if v_order_col is null then
    raise exception 'unknown leaderboard category: %', p_category;
  end if;

  select count(*) into v_total from public.creator_leaderboard_cache;

  execute format(
    'select rank, value from (
       select creator_id, row_number() over (order by %1$I desc, creator_id) as rank, %1$I as value
       from public.creator_leaderboard_cache
     ) ranked where creator_id = $1',
    v_order_col
  ) into v_rank, v_value using p_creator_id;

  -- v_rank is null (not an error) when the creator has 0 published levels
  -- and so isn't in the cache at all — the client should show "Unranked",
  -- not a fabricated position.
  return json_build_object('category', p_category, 'rank', v_rank, 'value', v_value, 'totalCreators', v_total);
end;
$$;

comment on function public.get_creator_rank is
  'Exact position for ONE creator in ONE category, reading the same cached/indexed view the leaderboard itself uses — cheap even with many creators, no full leaderboard download needed.';

grant execute on function public.get_creator_rank(uuid, text) to anon, authenticated;

-- get_creator_profile() now also returns the creator's exact Most Played
-- rank inline, so "Your Stats" gets it in the same round trip it already
-- makes — same signature/return shape as before, just one more field.
create or replace function public.get_creator_profile(p_creator_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
  v_rank json;
begin
  select public.get_creator_rank(p_creator_id, 'most_played') into v_rank;

  select json_build_object(
    'id', s.creator_id,
    'username', s.username,
    'displayName', coalesce(s.display_name, s.username),
    'avatarUrl', s.avatar_url,
    'creatorSince', s.creator_since,
    'totalPublished', s.total_published,
    'totalPlays', s.total_plays,
    'totalLikes', s.total_likes,
    'totalFavorites', s.total_favorites,
    'rank', v_rank,
    'achievements', coalesce((
      select json_agg(json_build_object('slug', a.achievement_slug, 'title', d.title, 'description', d.description, 'icon', d.icon, 'achievedAt', a.achieved_at) order by a.achieved_at)
      from public.creator_achievements a
      join public.achievement_defs d on d.slug = a.achievement_slug
      where a.creator_id = s.creator_id
    ), '[]'::json),
    'popularLevels', coalesce((
      select json_agg(json_build_object('id', l.id, 'title', l.title, 'plays', l.play_count, 'likes', l.like_count) order by l.play_count desc)
      from (
        select id, title, play_count, like_count
        from public.levels
        where creator_id = s.creator_id and status = 'published'
        order by play_count desc
        limit 10
      ) l
    ), '[]'::json)
  )
  into result
  from public.creator_stats s
  where s.creator_id = p_creator_id;

  return result;
end;
$$;

grant execute on function public.get_creator_profile(uuid) to anon, authenticated;
