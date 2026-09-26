-- ============================================================================
-- COMMUNITY WORLD — DISCOVER (ADDITIVE MIGRATION)
-- ============================================================================
-- Safe to run after 1_community_creator_leaderboards.sql and
-- 2_community_creator_system_api.sql. Backs the game's Discover tab with
-- exactly 4 categories — each an independent filter/sort over PUBLISHED
-- levels only, never a combined score:
--
--   most_played  -> highest play_count first
--   most_liked   -> highest like_count first
--   recent       -> newest published_at first
--   complex      -> highest self-declared difficulty (1-5) first
--
-- "Complex" is intentionally based on the creator's own difficulty rating
-- (public.levels.difficulty, 1-5 — see community_world.sql), not a
-- computed geometry-complexity score. There's no reliable, honest way to
-- derive "how complex a level actually is" from the compact level_data
-- blob without real gameplay analysis, and inventing a fake metric would
-- be worse than using the one real signal the creator already provides
-- at publish time.
-- ============================================================================

create or replace function public.get_discover_levels(
  p_category text default 'recent',  -- 'most_played' | 'most_liked' | 'recent' | 'complex'
  p_query text default null,          -- optional title search
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
  v_order_col text;
  v_search text := nullif(trim(coalesce(p_query, '')), '');
  v_total bigint;
  v_items json;
begin
  v_order_col := case p_category
    when 'most_played' then 'play_count'
    when 'most_liked'  then 'like_count'
    when 'complex'      then 'difficulty'
    when 'recent'        then 'published_at'
    else null
  end;

  if v_order_col is null then
    raise exception 'unknown discover category: %', p_category;
  end if;

  if v_search is not null then
    execute format(
      'select count(*) from public.levels where status = ''published'' and title ilike %L',
      '%' || v_search || '%'
    ) into v_total;
  else
    select count(*) into v_total from public.levels where status = 'published';
  end if;

  execute format(
    'select coalesce(json_agg(row), ''[]''::json) from (
       select json_build_object(
         ''id'', l.id,
         ''name'', l.title,
         ''difficulty'', l.difficulty,
         ''creator'', json_build_object(''id'', p.id, ''displayName'', coalesce(p.display_name, p.username)),
         ''stats'', json_build_object(''plays'', l.play_count, ''likes'', l.like_count, ''favorites'', l.favorite_count),
         ''publishedAt'', l.published_at
       ) as row
       from public.levels l
       join public.profiles p on p.id = l.creator_id
       where l.status = ''published'' %s
       order by %I desc, l.id
       limit %L offset %L
     ) t',
    case when v_search is not null then format('and l.title ilike %L', '%' || v_search || '%') else '' end,
    v_order_col, v_limit, v_offset
  ) into v_items;

  return json_build_object('category', p_category, 'page', v_page, 'limit', v_limit, 'total', v_total, 'items', v_items);
end;
$$;

comment on function public.get_discover_levels is
  'Public, paginated, published-only level browsing for the Discover tab. 4 independent categories, never a combined score. Search uses the existing idx_levels_title_trgm index.';

grant execute on function public.get_discover_levels(text, text, integer, integer) to anon, authenticated;


-- ============================================================================
-- FULL PLAYABLE LEVEL DATA (for the "PLAY" button on a Discover result)
-- ============================================================================
-- get_level_public() (community_creator_system_api.sql) deliberately
-- leaves out level_data — it's meant for lightweight list/detail screens.
-- Actually playing a level needs the real geometry, so this is a separate,
-- narrower function: PUBLISHED levels only (a level must be published to
-- be discoverable in the first place, so this never needs an "or you own
-- it" exception the way get_level_public does for a creator's own drafts).
create or replace function public.get_level_for_play(p_level_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'id', l.id,
    'name', l.title,
    'levelData', l.level_data
  )
  from public.levels l
  where l.id = p_level_id and l.status = 'published';
$$;

comment on function public.get_level_for_play is
  'Returns the full compact level_data for a PUBLISHED level only, for actually loading/playing it. Returns null for drafts, removed, or nonexistent levels — the caller should treat null as "not playable right now", not as an error.';

grant execute on function public.get_level_for_play(uuid) to anon, authenticated;
