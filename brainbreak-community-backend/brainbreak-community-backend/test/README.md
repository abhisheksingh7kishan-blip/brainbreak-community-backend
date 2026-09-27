# Regression test (offline)

`dispatch.test.mjs` exercises every consolidated route through the real
dispatcher files (`api/.../[...path].js`) and real controllers
(`src/controllers/*.js`), asserting each old URL still resolves to the
right handler, method, status code, and RPC call.

It runs fully offline against `test/mocks/supabase-js-stub.mjs` (a fake
`@supabase/supabase-js`), so it does **not** need a real Supabase project.
That mock is test-only and is never imported by the deployed app.

To run it locally:

```bash
npm install                     # installs the real @supabase/supabase-js
cp test/mocks/supabase-js-stub.mjs node_modules/@supabase/supabase-js-stub-tmp.mjs  # (see below)
```

Simplest one-liner (temporarily swaps in the stub, runs the test, restores
the real package):

```bash
mkdir -p node_modules/@supabase/supabase-js
cp package.json node_modules/@supabase/supabase-js/package.json 2>/dev/null || \
  echo '{"name":"@supabase/supabase-js","version":"0.0.0-stub","type":"module","main":"index.js"}' \
  > node_modules/@supabase/supabase-js/package.json
cp test/mocks/supabase-js-stub.mjs node_modules/@supabase/supabase-js/index.js
node test/dispatch.test.mjs
npm install   # restores the real package for deployment
```

This test is a development aid only — Vercel deployment does not run it.
