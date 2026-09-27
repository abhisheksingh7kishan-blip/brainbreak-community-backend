-- ============================================================================
-- COMMUNITY WORLD — CREATOR LEADERBOARDS & ACHIEVEMENTS (ADDITIVE MIGRATION)
-- ============================================================================
-- Safe to run on top of community_world.sql. Idempotent (IF NOT EXISTS /
-- CREATE OR REPLACE throughout). Never alters, drops, or renames any
-- existing table, column, trigger, policy, or RPC from the base schema.
--
-- Everything here is READ-derived from data that is already trustworthy:
--   public.levels.play_count / like_count / favorite_count
-- which can only change through the base schema's own SECURITY DEFINER
-- triggers (register_level_play / handle_level_like_change /
-- handle_level_favorite_change) — never by a client writing the column
-- directly. This migration adds NO new way to increment those numbers, so
-- every anti-spam guarantee the base schema already has (one like per user
-- per level, plays counted server-side, etc.) automatically carries over
-- to every leaderboard category below.
--
-- No single combined "best creator" score is computed anywhere in this
-- file — each category is an independent, separately-orderable metric.
-- ============================================================================


-- ============================================================================
-- 1. CREATOR STATS (live view — cheap, used for a single creator's own
--    "Your Stats" page and public profile lookups; NOT used for the
--    paginated global leaderboard, see the cached materialized view below).
-- ============================================================================
create or replace view public.creator_stats as
select
  p.id                                                as creator_id,
  p.username,
  p.display_name,
  p.avatar_url,
  p.created_at                                        as creator_since,
  count(l.id) filter (where l.status = 'published')                          as total_published,
  coalesce(sum(l.play_count)     filter (where l.status = 'published'), 0)   as total_plays,
  coalesce(sum(l.like_count)     filter (where l.status = 'published'), 0)   as total_likes,
  coalesce(sum(l.favorite_count) filter (where l.status = 'published'), 0)   as total_favorites,
  count(l.id) filter (where l.status = 'published' and l.play_count >= 1000)    as levels_over_1k_plays,
  count(l.id) filter (where l.status = 'published' and l.play_count >= 10000)   as levels_over_10k_plays,
  count(l.id) filter (where l.status = 'published' and l.play_count >= 100000)  as levels_over_100k_plays,
  max(l.published_at) filter (where l.status = 'published')                    as last_published_at,
  min(l.published_at) filter (where l.status = 'published')                    as first_published_at
from public.profiles p
left join public.levels l on l.creator_id = p.id
group by p.id;

comment on view public.creator_stats is
  'Live per-creator aggregate stats derived only from trusted, server-maintained counters on public.levels. Safe to expose publicly (no email/auth fields).';


-- ============================================================================
-- 2. CREATOR LEADERBOARD CACHE (materialized view — what the paginated,
--    high-traffic "Worldwide Creators" endpoint actually reads from, so a
--    request never has to scan/aggregate every level in the database).
-- ============================================================================
create materialized view if not exists public.creator_leaderboard_cache as
select
  creator_id, username, display_name, avatar_url, creator_since,
  total_published, total_plays, total_likes, total_favorites,
  levels_over_1k_plays, levels_over_10k_plays, levels_over_100k_plays,
  (levels_over_1k_plays + levels_over_10k_plays + levels_over_100k_plays) as popular_level_score,
  last_published_at, first_published_at
from public.creator_stats
where total_published > 0;

-- One index per rankable metric, each with creator_id as the deterministic
-- tie-breaker baked directly into the index so ORDER BY never needs a
-- separate sort step and ties always resolve the same way on every request.
create unique index if not exists idx_clc_creator_id           on public.creator_leaderboard_cache (creator_id);
create index if not exists idx_clc_most_played                 on public.creator_leaderboard_cache (total_plays desc, creator_id);
create index if not exists idx_clc_most_liked                  on public.creator_leaderboard_cache (total_likes desc, creator_id);
create index if not exists idx_clc_most_published               on public.creator_leaderboard_cache (total_published desc, creator_id);
create index if not exists idx_clc_most_favorited               on public.creator_leaderboard_cache (total_favorites desc, creator_id);
create index if not exists idx_clc_popular_levels                on public.creator_leaderboard_cache (popular_level_score desc, creator_id);

-- Refreshed on a schedule (e.g. a Vercel cron hitting a tiny service-role
-- endpoint every few minutes) rather than on every like/play, which is what
-- keeps the leaderboard cheap at "thousands of creators / millions of
-- plays" scale. CONCURRENTLY requires the unique index above.
create or replace function public.refresh_creator_leaderboard_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.creator_leaderboard_cache;
end;
$$;

comment on function public.refresh_creator_leaderboard_cache is
  'Call on a schedule (Vercel cron, service-role only) to refresh ranking positions. Not exposed to anon/authenticated.';


-- ============================================================================
-- 3. PAGINATED LEADERBOARD RPC
--    get_creator_leaderboard(category, page, limit) -> ranked page.
--    This is the ONE function the Vercel API calls for every category tab;
--    it only ever SELECTs from the cache above, so it can't be used to
--    influence anyone's stats.
-- ============================================================================
create or replace function public.get_creator_leaderboard(
  p_category text,
  p_page integer default 1,
  p_limit integer default 25
)
returns table (
  rank bigint,
  creator_id uuid,
  username text,
  display_name text,
  avatar_url text,
  creator_since timestamptz,
  value bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_offset integer;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100); -- hard cap per page
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_order_col text;
begin
  v_offset := (v_page - 1) * v_limit;

  v_order_col := case p_category
    when 'most_played'     then 'total_plays'
    when 'most_liked'      then 'total_likes'
    when 'most_published'  then 'total_published'
    when 'most_favorited'  then 'total_favorites'
    when 'popular_levels'  then 'popular_level_score'
    else null
  end;

  if v_order_col is null then
    raise exception 'unknown leaderboard category: %', p_category;
  end if;

  return query execute format(
    'select
       row_number() over (order by %1$I desc, creator_id) + $1 as rank,
       creator_id, username, display_name, avatar_url, creator_since,
       %1$I as value
     from public.creator_leaderboard_cache
     order by %1$I desc, creator_id
     limit $2 offset $1',
    v_order_col
  ) using v_offset, v_limit;
end;
$$;

comment on function public.get_creator_leaderboard is
  'Public, read-only, paginated ranking for one category at a time (never a combined score). Deterministic tie-break: metric desc, then creator_id.';

grant execute on function public.get_creator_leaderboard(text, integer, integer) to anon, authenticated;


-- ============================================================================
-- 4. PUBLIC CREATOR PROFILE RPC
--    Everything an anonymous visitor is allowed to see about one creator:
--    live stats + achievements + their published levels. Never returns
--    email, role, or any auth.users field.
-- ============================================================================
create or replace function public.get_creator_profile(p_creator_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
begin
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
    'achievements', coalesce((
      select json_agg(json_build_object('slug', a.slug, 'title', d.title, 'description', d.description, 'icon', d.icon, 'achievedAt', a.achieved_at) order by a.achieved_at)
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

comment on function public.get_creator_profile is
  'Public creator profile payload. Only ever reads profiles/levels/achievements columns already safe for public exposure.';

grant execute on function public.get_creator_profile(uuid) to anon, authenticated;


-- ============================================================================
-- 5. ACHIEVEMENTS
-- ============================================================================
create table if not exists public.achievement_defs (
  slug text primary key check (slug ~ '^[a-z0-9_]{2,40}$'),
  title text not null check (char_length(title) <= 60),
  description text not null check (char_length(description) <= 200),
  icon text,
  sort_order smallint not null default 0
);

comment on table public.achievement_defs is 'Static catalog of achievement types. Edited by admins only (service_role); never client-writable.';

insert into public.achievement_defs (slug, title, description, icon, sort_order) values
  ('first_creation',   'First Creation',   'Published your first Community World level.',                '🎉', 10),
  ('rising_creator',   'Rising Creator',   'Reached 100 total plays across your levels.',                 '🌱', 20),
  ('known_creator',    'Known Creator',    'Reached 1,000 total plays across your levels.',                '⭐', 30),
  ('popular_creator',  'Popular Creator',  'Reached 10,000 total plays across your levels.',               '🔥', 40),
  ('legendary_creator','Legendary Creator','Reached 100,000 total plays across your levels.',              '👑', 50),
  ('like_magnet',      'Like Magnet',      'Reached 500 total likes across your levels.',                  '💜', 60),
  ('fan_favorite',     'Fan Favorite',     'Reached 250 total favorites across your levels.',              '💎', 70),
  ('level_factory',    'Level Factory',    'Published 25 levels.',                                         '🏭', 80),
  ('viral_level',      'Viral Level',      'One of your levels passed 10,000 plays.',                      '🚀', 90),
  ('community_favorite','Community Favorite','One of your levels passed 1,000 likes.',                     '🏆', 100),
  ('veteran_creator',  'Veteran Creator',  'Creator for 6+ months with at least 5 published levels.',      '🎖️', 110)
on conflict (slug) do update set
  title = excluded.title, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order;

create table if not exists public.creator_achievements (
  creator_id uuid not null references public.profiles(id) on delete cascade,
  achievement_slug text not null references public.achievement_defs(slug) on delete cascade,
  achieved_at timestamptz not null default now(),
  primary key (creator_id, achievement_slug)
);

comment on table public.creator_achievements is 'Awarded achievements. Only ever inserted by sync_creator_achievements() below, never by a raw client insert.';

create index if not exists idx_creator_achievements_creator on public.creator_achievements (creator_id);

-- Re-derives which achievements a creator has EARNED from their real,
-- trusted stats and inserts any newly-qualifying ones. It never removes an
-- achievement and never accepts a value from the caller other than "whose
-- achievements to check" — so calling it repeatedly, or a client calling it
-- for themselves after every play, cannot fabricate anything: the insert
-- conditions are always re-evaluated against public.creator_stats.
create or replace function public.sync_creator_achievements(p_creator_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_viral_level boolean;
  v_community_favorite_level boolean;
begin
  select * into s from public.creator_stats where creator_id = p_creator_id;
  if not found then return; end if;

  select exists(select 1 from public.levels where creator_id = p_creator_id and status = 'published' and play_count >= 10000) into v_viral_level;
  select exists(select 1 from public.levels where creator_id = p_creator_id and status = 'published' and like_count >= 1000) into v_community_favorite_level;

  insert into public.creator_achievements (creator_id, achievement_slug)
  select p_creator_id, slug from (values
    ('first_creation',    s.total_published >= 1),
    ('rising_creator',    s.total_plays >= 100),
    ('known_creator',     s.total_plays >= 1000),
    ('popular_creator',   s.total_plays >= 10000),
    ('legendary_creator', s.total_plays >= 100000),
    ('like_magnet',       s.total_likes >= 500),
    ('fan_favorite',      s.total_favorites >= 250),
    ('level_factory',     s.total_published >= 25),
    ('viral_level',       v_viral_level),
    ('community_favorite',v_community_favorite_level),
    ('veteran_creator',   s.creator_since <= now() - interval '6 months' and s.total_published >= 5)
  ) as candidate(slug, qualifies)
  where qualifies
  on conflict (creator_id, achievement_slug) do nothing;
end;
$$;

comment on function public.sync_creator_achievements is
  'Idempotent, additive-only. Safe to call from a trusted backend after any publish/like/favorite/play event, or on a schedule.';

-- Deliberately NOT granted to anon/authenticated: achievement syncing is
-- triggered by the trusted Vercel backend (service_role) after events it
-- already validated, not by the client directly.


-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================
alter table public.achievement_defs enable row level security;
alter table public.creator_achievements enable row level security;

drop policy if exists achievement_defs_select_all on public.achievement_defs;
create policy achievement_defs_select_all on public.achievement_defs for select using (true);

drop policy if exists creator_achievements_select_all on public.creator_achievements;
create policy creator_achievements_select_all on public.creator_achievements for select using (true);
-- No insert/update/delete policies for anon/authenticated: rows are only
-- ever written by sync_creator_achievements(), a SECURITY DEFINER function
-- callable only by the service-role backend.

grant select on public.achievement_defs to anon, authenticated;
grant select on public.creator_achievements to anon, authenticated;
grant select on public.creator_stats to anon, authenticated;
-- creator_leaderboard_cache is intentionally NOT granted directly — always
-- go through get_creator_leaderboard() so pagination/limits are enforced.
