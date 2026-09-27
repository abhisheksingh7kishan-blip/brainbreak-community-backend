// Minimal stand-in for @supabase/supabase-js, used ONLY by
// test/dispatch.test.mjs so the routing/regression test can run offline,
// without a real Supabase project or network access. This file is never
// imported by the actual application code and is NOT part of the
// deployed backend.
//
// It fakes just enough of the client surface (auth.getUser, from().*,
// rpc()) for every dispatcher branch to be exercised end-to-end.
export function createClient(url, key, opts) {
  return {
    __stub: true, url, key, opts,
    auth: {
      async getUser() {
        return { data: { user: { id: 'test-user-id' } }, error: null };
      },
    },
    from(table) {
      const chain = {
        _table: table,
        select() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        range() { return chain; },
        limit() { return chain; },
        single: async () => ({ data: { role: 'admin' }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        insert() { return chain; },
        update() { return chain; },
        then(resolve) { resolve({ data: [], error: null, count: 0 }); },
      };
      return chain;
    },
    rpc(fnName, params) {
      // Real Postgres functions declared `returns table(...)` come back
      // as arrays via PostgREST; scalar/row-returning functions come
      // back as a single object. Mirror that shape here so controllers
      // that .map() over table-returning RPCs (e.g. the leaderboard)
      // behave the same as they would against the real database.
      if (fnName === 'get_creator_leaderboard' || fnName === 'get_creator_achievements') {
        return Promise.resolve({
          data: [{ __rpcCalled: fnName, params, rank: 1, creator_id: 'c1', value: 10 }],
          error: null,
        });
      }
      return Promise.resolve({ data: { __rpcCalled: fnName, params }, error: null });
    },
  };
}
