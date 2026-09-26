-- ============================================================================
-- COMMUNITY WORLD — CREATOR SYSTEM API SUPPORT (ADDITIVE MIGRATION)
-- ============================================================================
-- Safe to run after community_world.sql and community_creator_leaderboards.sql.
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS throughout). Adds nothing that
-- alters, drops, or renames any existing table/column/policy/RPC.
--
-- Every function here either:
--   (a) relies on auth.uid() and must be called through a Supabase client
--       that forwards the CALLING PLAYER'S OWN access token (anon key +
--       `Authorization: Bearer <user_jwt>`), exactly like publish_level()/
--       like_level()/register_level_play() already do in community_world.sql, or
--   (b) is a public, read-only lookup safe to call with just the anon key,
--       same as get_creator_leaderboard()/get_creator_profile().
-- Never call anything below with the service-role key from a path that
-- accepts client input — see the Vercel files for exactly which is which.
-- ============================================================================


-- ============================================================================
-- 1. DISPLAY NAME UPDATES
-- ============================================================================
-- Centralizes validation so it can never be bypassed by a raw PATCH to the
-- profiles row (RLS already lets a user update their own row, but this is
-- the one path the client should actually use so "empty name" / "control
-- characters" / "too long" are rejected the same way every time).
create or replace function public.update_display_name(p_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_display_name, ''));
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if v_name = '' then
    raise exception 'display name cannot be empty';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'display name too long';
  end if;
  if v_name ~ '[\x00-\x1F\x7F]' then
    raise exception 'display name contains unsupported characters';
  end if;

  update public.profiles
    set display_name = v_name
    where id = auth.uid()
    returning * into v_profile;

  if not found then
    raise exception 'profile not found';
  end if;
  return v_profile;
end;
$$;

comment on function public.update_display_name is
  'The only sanctioned way to change display_name. Levels reference creator_id, not a copied name, so every existing published level shows the new name immediately — see get_level_public()/get_creator_levels() below.';

grant execute on function public.update_display_name(text) to authenticated;


-- ============================================================================
-- 2. COMPACT PUBLIC LEVEL LOOKUP (level + creator, one round trip)
-- ============================================================================
-- Returns a level's public-safe fields plus its creator's CURRENT display
-- name (looked up live via creator_id -> profiles, never a name baked into
-- the level row) in the compact shape the client actually needs. A caller
-- may see their own non-published level; anyone else only sees it if
-- status = 'published'.
create or replace function public.get_level_public(p_level_id uuid)
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
    'id', l.id,
    'name', l.title,
    'description', l.description,
    'difficulty', l.difficulty,
    'status', l.status,
    'creator', json_build_object('id', p.id, 'displayName', coalesce(p.display_name, p.username)),
    'stats', json_build_object('plays', l.play_count, 'likes', l.like_count, 'favorites', l.favorite_count)
  )
  into result
  from public.levels l
  join public.profiles p on p.id = l.creator_id
  where l.id = p_level_id
    and (l.status = 'published' or l.creator_id = auth.uid());

  return result; -- null if not found / not visible to this caller
end;
$$;

comment on function public.get_level_public is
  'Compact level+creator payload for level discovery/detail screens. Returns null (not an error) for a level that does not exist or is not visible to the caller, so the client can show a clean "unavailable" state.';

grant execute on function public.get_level_public(uuid) to anon, authenticated;


-- ============================================================================
-- 3. PAGINATED CREATOR LEVELS (another creator's published levels)
-- ============================================================================
-- A creator's OWN levels (any status) are simpler: select public.levels
-- where creator_id = auth.uid(), already covered by the base RLS policy —
-- no RPC needed for that case, see api/community/creators/me/levels.js.
-- This one is specifically for browsing someone ELSE's public levels.
create or replace function public.get_creator_levels(
  p_creator_id uuid,
  p_page integer default 1,
  p_limit integer default 20
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_offset integer := (v_page - 1) * v_limit;
  v_total bigint;
  v_items json;
begin
  select count(*) into v_total from public.levels where creator_id = p_creator_id and status = 'published';

  select coalesce(json_agg(row), '[]'::json) into v_items
  from (
    select json_build_object(
      'id', id, 'name', title,
      'stats', json_build_object('plays', play_count, 'likes', like_count, 'favorites', favorite_count)
    ) as row
    from public.levels
    where creator_id = p_creator_id and status = 'published'
    order by published_at desc, id
    limit v_limit offset v_offset
  ) t;

  return json_build_object('page', v_page, 'limit', v_limit, 'total', v_total, 'items', v_items);
end;
$$;

grant execute on function public.get_creator_levels(uuid, integer, integer) to anon, authenticated;


-- ============================================================================
-- 4. ACHIEVEMENTS-ONLY LOOKUP
-- ============================================================================
-- get_creator_profile() (community_creator_leaderboards.sql) already
-- includes achievements; this thinner endpoint exists only because the
-- spec asks for a dedicated achievements call the client can use without
-- pulling the rest of the profile payload.
create or replace function public.get_creator_achievements(p_creator_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
    'slug', a.achievement_slug, 'title', d.title, 'description', d.description,
    'icon', d.icon, 'achievedAt', a.achieved_at
  ) order by a.achieved_at), '[]'::json)
  from public.creator_achievements a
  join public.achievement_defs d on d.slug = a.achievement_slug
  where a.creator_id = p_creator_id;
$$;

grant execute on function public.get_creator_achievements(uuid) to anon, authenticated;
