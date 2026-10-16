#!/usr/bin/env node
/**
 * Lightweight local stand-in for Supabase's REST layer, for development and end-to-end tests when
 * you don't want to run the full `supabase start` stack.
 *
 * It serves exactly what the app uses — `POST /rest/v1/rpc/leery_*` — on top of a plain Postgres
 * (any 14+; a throwaway Docker container is fine), calling the functions as the `anon` role just
 * like PostgREST does. Realtime is not provided: run the app with VITE_REALTIME=off (polling only).
 *
 *   docker run -d --name leery-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:54399:5432 postgres:16-alpine
 *   DEV_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54399/postgres npm run dev:api
 *   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=dev VITE_REALTIME=off npm run dev
 *
 * The first run creates the `leery_dev` database, the anon/authenticated roles and applies the Leery
 * migrations. Set RESET=1 to drop and recreate it.
 */
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ADMIN_URL = process.env.DEV_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54399/postgres";
const DB_NAME = process.env.DEV_DB_NAME ?? "leery_dev";
const PORT = Number(process.env.PORT ?? 54321);
const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");

async function ensureDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$`);
  if (process.env.RESET) await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  const exists = (await admin.query("select 1 from pg_database where datname = $1", [DB_NAME])).rowCount > 0;
  if (!exists) await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  const has = (await db.query("select 1 from pg_namespace where nspname = 'game'")).rowCount > 0;
  if (!has) {
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      await db.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
      console.log(`applied ${f}`);
    }
  }
  await db.end();
  return url.toString();
}

const dbUrl = await ensureDatabase();
// Every connection runs as `anon`, the role PostgREST uses for unauthenticated requests.
const pool = new pg.Pool({ connectionString: dbUrl, max: 10, options: "-c role=anon" });

/** name -> [{ name, type }] for the leery_* functions, read once from the catalog. */
const signatures = new Map();
{
  const { rows } = await new pg.Pool({ connectionString: dbUrl, max: 1 }).query(`
    select p.proname,
           p.proargnames as names,
           (select array_agg(format_type(t, null) order by ord) from unnest(p.proargtypes) with ordinality u(t, ord)) as types
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'leery\\_%'`);
  for (const r of rows) signatures.set(r.proname, r.names.map((name, i) => ({ name, type: r.types[i] })));
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*, authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  const pathname = req.url?.split("?")[0] ?? "";
  if (req.method === "GET" && (pathname === "/" || pathname === "/health")) return send(res, 200, { ok: true });
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(pathname);
  if (req.method !== "POST" || !m) return send(res, 404, { message: "not found", code: "PGRST000" });

  // The URL only selects an entry; the query below uses the catalog's own spelling of the name, never the request's.
  const entry = [...signatures].find(([name]) => name === m[1]);
  if (!entry) {
    return send(res, 404, { code: "PGRST202", message: `Could not find the function public.${m[1]} in the schema cache`, details: null, hint: null });
  }
  const [fn, sig] = entry;

  try {
    const body = await readBody(req);
    const args = sig.filter((a) => a.name in body);
    const named = args.map((a, i) => `${pg.escapeIdentifier(a.name)} => $${i + 1}::${a.type}`).join(", ");
    const result = await pool.query(`select public.${pg.escapeIdentifier(fn)}(${named}) as r`, args.map((a) => body[a.name]));
    return send(res, 200, result.rows[0].r);
  } catch (e) {
    // PostgREST maps RAISE EXCEPTION (P0001) to 400 with the message; permission errors to 401/403, etc.
    const status = e.code === "P0001" ? 400 : e.code === "42501" ? 403 : e instanceof SyntaxError ? 400 : 500;
    return send(res, status, { code: e.code ?? "XX000", message: e.message, details: null, hint: null });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev API on http://127.0.0.1:${PORT}  (db: ${DB_NAME}, ${signatures.size} functions)`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close();
    pool.end().finally(() => process.exit(0));
  });
}
