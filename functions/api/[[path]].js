// Lookbook portal API — Cloudflare Pages Functions + D1
// Routes: /api/login, /api/logout, /api/me, /api/set-password, /api/comments,
//         /api/project-config, /api/notes (+ scope viewer routes)

const encoder = new TextEncoder();
const COOKIE = "lb_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const PBKDF2_ITERS = 100000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function buf2hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hex2buf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return buf2hex(sig);
}
async function makeToken(secret, userId) {
  const exp = Date.now() + MAX_AGE * 1000;
  const body = `${userId}.${exp}`;
  return `${body}.${await hmacHex(secret, body)}`;
}
async function verifyToken(secret, token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (!userId || !exp || Date.now() > Number(exp)) return null;
  const expected = await hmacHex(secret, `${userId}.${exp}`);
  return timingSafeEqualHex(expected, sig) ? userId : null;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" }, km, 256
  );
  return `pbkdf2$${PBKDF2_ITERS}$${buf2hex(salt.buffer)}$${buf2hex(bits)}`;
}
async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("pbkdf2$")) return false;
  const [, iterStr, saltHex, hashHex] = stored.split("$");
  const km = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hex2buf(saltHex), iterations: Number(iterStr), hash: "SHA-256" }, km, 256
  );
  return timingSafeEqualHex(buf2hex(bits), hashHex);
}

// Current password check: first-time accounts still use their PIN (last4).
async function currentPasswordOk(user, pw) {
  const firstTime = user.must_change_password || !user.password_hash;
  return firstTime ? (String(pw) === String(user.last4 || "") && !!user.last4) : await verifyPassword(pw, user.password_hash);
}
function passwordIssue(pw) {
  pw = String(pw || "");
  if (pw.length < 8) return "at least 8 characters";
  if (!/[a-z]/.test(pw)) return "a lowercase letter";
  if (!/[A-Z]/.test(pw)) return "an uppercase letter";
  if (!/[0-9]/.test(pw)) return "a number";
  return null;
}

// Fail closed: there is no fallback secret. onRequest() refuses to serve auth
// routes when SESSION_SECRET is missing (see CONFIG GUARD), so this never signs
// with a guessable key.
function secretOf(env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured.");
  return env.SESSION_SECRET;
}
// Public base URL of the lookbook (invite links, emails). Never derived from the
// caller's host, so CRM calls through an old domain still produce new-domain links.
const DEFAULT_LOOKBOOK_URL = "https://lookbook.betterlivingsystems.app";
function lookbookUrl(env) {
  return String(env.LOOKBOOK_URL || DEFAULT_LOOKBOOK_URL).replace(/\/+$/, "");
}
const DEFAULT_NOTES_FROM = "Better Living Systems <noreply@betterlivingsystems.app>";
const DEFAULT_OWNER_EMAIL = "corban@betterlivingsystems.com";
function isTeam(user) { return !!user && (user.role === "admin" || user.role === "sales"); }
// Team (admin/sales) see every project; clients only their assigned project ids.
function canView(user, pid) { return !!user && !!pid && (isTeam(user) || assignedIds(user).includes(pid)); }
function assignedIds(user) {
  return (user.project_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function canAccess(user, pid) {
  return user.role === "admin" || assignedIds(user).includes(pid);
}
function publicUser(user) {
  return {
    name: user.name || user.last_name,
    role: user.role,
    projects: assignedIds(user),
    all: user.role === "admin",
    mustChange: !!user.must_change_password,
  };
}
async function currentUser(context) {
  // Accept the session token via Authorization: Bearer (primary, cookie-independent)
  // or the lb_session cookie (fallback). The Bearer path keeps sessions working even
  // when the browser / edge won't persist the Set-Cookie.
  const authHeader = context.request.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const cookieTok = parseCookies(context.request)[COOKIE];
  const uid = await verifyToken(secretOf(context.env), bearer || cookieTok);
  if (!uid || !context.env.DB) return null;
  const u = await context.env.DB
    .prepare("SELECT id,last_name,name,role,project_ids,password_hash,must_change_password,active,email FROM users WHERE id=?")
    .bind(uid).first();
  // Deactivated accounts (soft-disabled) can no longer use an existing cookie.
  if (u && u.active === 0) return null;
  return u;
}
function cookieHeader(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}
function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// Shared team-auth gate for cross-app (CRM) endpoints.
// Fail closed: when TEAM_AUTH_KEY is unset every team endpoint rejects the call
// (callers check gate.ok only).
async function teamAuth(request, env) {
  if (!env.TEAM_AUTH_KEY) return { configured: false, ok: false };
  const provided = request.headers.get("x-team-auth") || "";
  if (!provided) return { configured: true, ok: false };
  const ok = timingSafeEqualHex(
    await hmacHex(env.TEAM_AUTH_KEY, "k"),
    await hmacHex(provided, "k")
  );
  return { configured: true, ok };
}

// ---- Lookbook system categories ----
const LOOKBOOK_CATEGORIES = [
  {id:"lighting",label:"Lighting"},
  {id:"shades",label:"Window Treatments"},
  {id:"theater",label:"Theater"},
  {id:"tvs",label:"TVs"},
  {id:"outdoor-tv",label:"Outdoor TV"},
  {id:"outdoor-audio",label:"Outdoor Audio"},
  {id:"outdoor-lighting",label:"Outdoor Lighting"},
  {id:"whole-home-audio",label:"Whole-Home Audio"},
  {id:"control-devices",label:"Control Devices"},
  {id:"home-protection",label:"Home Protection"},
  {id:"misc",label:"Misc"},
  {id:"pre-wire",label:"Pre-Wire"},
];
function normAddress(a){return String(a||"").toLowerCase().replace(/[.,#]/g," ").replace(/\s+/g," ").trim();}
function safeJSON(s,f){try{const v=JSON.parse(s);return v==null?f:v;}catch(e){return f;}}
async function ensureProjectsTable(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS crm_projects (
    id TEXT PRIMARY KEY, address_key TEXT UNIQUE, client_name TEXT, address TEXT,
    systems TEXT, items TEXT, photos TEXT, created_at TEXT, updated_at TEXT
  )`).run();
}
const LOOMIS_FLOORS = [
  { floor: "Main", rooms: ["Entry & Vestibule","Foyer","Dining Room","Living Room","West Gallery","East Gallery","Kitchen","Breakfast","Family Room","Pantry","Tasting Room","Wine Room","Powder Room","Mud Room","Laundry","Chat Room","Bedroom 2","Bath 2","Master Bedroom","Master Bath","Master Water Closet","Her Closet","His Closet","Dressing","His Sauna","Fitness Room","Garage & Garage Bath","Elevator"] },
  { floor: "Upper", rooms: ["Bridge","Loft","Recreation Room","Snack Bar","Rec Powder Room","Theater","VIP Suite","VIP Bath & Closet","Bedroom 4","Bath 4 & Closet","Bedroom 5","Bath 5 & Closet","East Hall","Upstairs Laundry","Storage / Equipment 1 & 2"] },
  { floor: "Exterior", rooms: ["Front Entry","Screened Porch","Outdoor Living & Pool Deck","Pool Bath","Covered Terraces & Terrace (Upper)","Zen Garden & Service Yard"] },
];
function slugify(s){ return String(s).toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""); }
async function ensureScopeTables(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scope_projects (
    id TEXT PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT
  )`).run();
  // Newer per-project config columns (ignore if they already exist).
  try { await env.DB.prepare("ALTER TABLE scope_projects ADD COLUMN owner_email TEXT").run(); } catch(e){}
  try { await env.DB.prepare("ALTER TABLE scope_projects ADD COLUMN category_vis TEXT").run(); } catch(e){}
  try { await env.DB.prepare("ALTER TABLE scope_projects ADD COLUMN client_last_name TEXT").run(); } catch(e){}
  // "Project Scope by Room" view: per-project eyebrow location + footer note (additive).
  try { await env.DB.prepare("ALTER TABLE scope_projects ADD COLUMN scope_location TEXT").run(); } catch(e){}
  try { await env.DB.prepare("ALTER TABLE scope_projects ADD COLUMN scope_footer TEXT").run(); } catch(e){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scope_rooms (
    id TEXT PRIMARY KEY, project_id TEXT, name TEXT, floor TEXT, drawing_url TEXT,
    scope_text TEXT, callouts TEXT, line_items TEXT, sort INTEGER DEFAULT 0,
    updated_at TEXT, updated_by TEXT
  )`).run();
  try { await env.DB.prepare("ALTER TABLE scope_rooms ADD COLUMN floor TEXT").run(); } catch(e){}
  try { await env.DB.prepare("ALTER TABLE scope_rooms ADD COLUMN line_items TEXT").run(); } catch(e){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scope_meta (key TEXT PRIMARY KEY, value TEXT)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scope_plans (
    id TEXT PRIMARY KEY, project_id TEXT, label TEXT, page_no INTEGER,
    mime TEXT, img BLOB, created_at TEXT, created_by TEXT
  )`).run();
  const now = new Date().toISOString();
  // Default the project owner email where unset (editable per project afterwards).
  try { await env.DB.prepare("UPDATE scope_projects SET owner_email=? WHERE owner_email IS NULL OR owner_email=''").bind(DEFAULT_OWNER_EMAIL).run(); } catch(e){}
  // One-time Loomis seed. SAFETY: this never deletes anything. It only runs when
  // the seed flag is missing AND the Loomis project has no rooms at all; if rooms
  // already exist the flag is simply (re)written. (Previously a missing flag wiped
  // every Loomis room and reseeded 49 empty ones, and the project was recreated on
  // every request.)
  const flag = await env.DB.prepare("SELECT value FROM scope_meta WHERE key=?").bind("isleworth_rooms_v2").first();
  if (flag) return;
  const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM scope_rooms WHERE project_id=?").bind("loomis-isleworth").first();
  if (!have || !have.n) {
    const proj = await env.DB.prepare("SELECT id FROM scope_projects WHERE id=?").bind("loomis-isleworth").first();
    if (!proj) {
      await env.DB.prepare("INSERT INTO scope_projects (id,name,created_at,updated_at,owner_email) VALUES (?,?,?,?,?)")
        .bind("loomis-isleworth","Loomis Isleworth",now,now,DEFAULT_OWNER_EMAIL).run();
    }
    let sort = 0;
    for (const grp of LOOMIS_FLOORS) {
      for (const name of grp.rooms) {
        const id = "room-" + slugify(grp.floor) + "-" + slugify(name);
        await env.DB.prepare("INSERT INTO scope_rooms (id,project_id,name,floor,drawing_url,scope_text,callouts,sort,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(id, "loomis-isleworth", name, grp.floor, null, "", "[]", sort++, now).run();
      }
    }
  }
  await env.DB.prepare("INSERT OR IGNORE INTO scope_meta (key,value) VALUES (?,?)").bind("isleworth_rooms_v2", now).run();
}
function rowToScopeRoom(r){
  return { id:r.id, project_id:r.project_id, name:r.name, floor:r.floor||null, drawing_url:r.drawing_url||null,
    scope_text:r.scope_text||"", callouts:safeJSON(r.callouts,[]), line_items:safeJSON(r.line_items,[]), sort:r.sort||0,
    updated_at:r.updated_at, updated_by:r.updated_by||null };
}
// ---- Plans edit: validate a markup overlay (all coordinates normalised 0..1) ----
function cleanMarkup(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
  const n01 = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.min(1, Math.round(x * 100000) / 100000)) : null; };
  const str = (v, m) => String(v == null ? "" : v).slice(0, m);
  const color = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v) : null);
  const out = [];
  for (const it of d.items.slice(0, 3000)) {
    if (!it || typeof it !== "object") continue;
    const x = n01(it.x), y = n01(it.y);
    if (x === null || y === null) continue;
    const id = str(it.id || ("m" + Math.random().toString(36).slice(2, 9)), 40);
    if (it.t === "sym") out.push({ t: "sym", id, k: str(it.k, 60), x, y, s: str(it.s, 200) });
    else if (it.t === "text") { const s = str(it.s, 500); if (s.trim()) out.push({ t: "text", id, x, y, s, c: color(it.c) || "#c0392b", z: Math.max(0.5, Math.min(4, Number(it.z) || 1)) }); }
    else if (it.t === "note") { const s = str(it.s, 1000); if (s.trim()) out.push({ t: "note", id, x, y, s }); }
    else if (it.t === "erase") {
      // opaque patch covering something printed on the plan (the image itself is never changed)
      const w = n01(it.w), h = n01(it.h);
      if (!w || !h) continue;
      const base = { t: "erase", id, x, y, w: Math.max(0.0001, Math.min(w, 1 - x)), h: Math.max(0.0001, Math.min(h, 1 - y)), c: color(it.c) || "#ffffff" };
      if (it.m === "brush") {
        const pts = (Array.isArray(it.pts) ? it.pts : []).slice(0, 2000)
          .map((p) => Array.isArray(p) ? [n01(p[0]), n01(p[1])] : null)
          .filter((p) => p && p[0] !== null && p[1] !== null)
          .map((p) => [Math.round(p[0] * 10000) / 10000, Math.round(p[1] * 10000) / 10000]);
        if (!pts.length) continue;
        const sw = Math.max(0.0005, Math.min(0.25, Number(it.sw) || 0.01));
        const ar = Math.max(0.05, Math.min(20, Number(it.ar) || 1));
        out.push({ ...base, m: "brush", pts, sw, ar });
      } else out.push({ ...base, m: "rect" });
    }
    else if (it.t === "wire") {
      // generated wiring run: n = anchor points (device(s) ... source), d = the symbol id at each
      // anchor (the run follows a moved symbol), g = per-leg [orientation h|v, bend position|null]
      const pts = (Array.isArray(it.n) ? it.n : []).slice(0, 400)
        .map((p) => Array.isArray(p) ? [n01(p[0]), n01(p[1])] : null)
        .filter((p) => p && p[0] !== null && p[1] !== null);
      if (pts.length < 2) continue;
      const d = pts.map((_, i) => (Array.isArray(it.d) && it.d[i] != null) ? str(it.d[i], 40) : null);
      const g = pts.slice(1).map((_, i) => { const q = Array.isArray(it.g) ? it.g[i] : null; const o = (q && q[0] === "v") ? "v" : "h"; const m = q && q[1] != null ? n01(q[1]) : null; return [o, m]; });
      const r = ["home", "pair", "chain"].includes(it.r) ? it.r : "home";
      out.push({ t: "wire", id, k: str(it.k, 60), r, w: str(it.w, 60), c: color(it.c) || "#888888", x: pts[0][0], y: pts[0][1], n: pts, d, g });
    }
    else if (it.t === "room") {
      const w = n01(it.w), h = n01(it.h);
      if (!w || !h || w < 0.005 || h < 0.005) continue;
      out.push({ t: "room", id, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y), room_id: str(it.room_id, 80) || null, name: str(it.name, 120) });
    }
  }
  const res = { items: out };
  // plan scale for wire lengths: two points (0..1) a known real distance apart
  const sc = d.scale;
  if (sc && typeof sc === "object" && Array.isArray(sc.a) && Array.isArray(sc.b)) {
    const a = [n01(sc.a[0]), n01(sc.a[1])], b = [n01(sc.b[0]), n01(sc.b[1])], dist = Number(sc.d);
    if (a[0] !== null && a[1] !== null && b[0] !== null && b[1] !== null && dist > 0 && dist < 100000)
      res.scale = { a, b, d: Math.round(dist * 100) / 100, u: sc.u === "m" ? "m" : "ft" };
  }
  const ar = Number(d.ar); if (ar > 0.05 && ar < 20) res.ar = Math.round(ar * 100000) / 100000; // plan height / width
  return res;
}
// Plans edit: validate a legend item's wiring rule (stored as JSON text in plan_legend.wiring)
function cleanWiring(w) {
  if (w == null || w === "") return null;
  if (typeof w === "string") { try { w = JSON.parse(w); } catch (e) { return null; } }
  if (!w || typeof w !== "object") return null;
  const rule = ["home", "pair", "chain", "none", "source"].includes(w.rule) ? w.rule : "none";
  const o = { rule };
  if (rule === "source") o.src = w.src === "panel" ? "panel" : "rack";
  else if (rule !== "none") {
    o.to = w.to === "panel" ? "panel" : w.to === "rack" ? "rack" : (rule === "chain" ? "panel" : "rack");
    o.wire = String(w.wire || "").trim().slice(0, 40);
    if (/^#[0-9a-fA-F]{6}$/.test(String(w.color || ""))) o.color = String(w.color);
    const mx = Math.round(Number(w.max) || 0); if (mx > 0) o.max = Math.min(100, mx);
  }
  return JSON.stringify(o);
}
function canEditScope(user){ return isTeam(user); }
async function makeInviteToken(secret, userId, ttlMs){
  const exp = Date.now() + (ttlMs || 7*24*60*60*1000);
  const body = `${userId}.${exp}.inv`;
  return `${body}.${await hmacHex(secret, body)}`;
}
async function verifyInviteToken(secret, token){
  if(!token) return null;
  const parts = String(token).split(".");
  if(parts.length !== 4) return null;
  const [userId, exp, tag, sig] = parts;
  if(tag !== "inv" || !userId || !exp || Date.now() > Number(exp)) return null;
  const expected = await hmacHex(secret, `${userId}.${exp}.inv`);
  return timingSafeEqualHex(expected, sig) ? userId : null;
}
async function ensureUsersColumns(env){
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN email TEXT").run(); } catch(e){}
  try { await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)").run(); } catch(e){}
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1").run(); } catch(e){}
  // Backfill a stable id for any user row missing one. Users provisioned via the
  // invite endpoint were inserted without an explicit id (the TEXT primary key
  // allowed NULL), so their session token was signed with uid "null" and never
  // resolved to a user — logins "succeeded" but no session persisted. Setting
  // id = rowid gives every such user a valid, stable identifier.
  try { await env.DB.prepare("UPDATE users SET id = CAST(rowid AS TEXT) WHERE id IS NULL OR id = ''").run(); } catch(e){}
}
function rowToProject(r){
  return { id:r.id, address_key:r.address_key, client_name:r.client_name, address:r.address,
    systems:safeJSON(r.systems,[]), items:safeJSON(r.items,[]), photos:safeJSON(r.photos,[]),
    created_at:r.created_at, updated_at:r.updated_at };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return json({ error: "Database not connected yet. Bind D1 as DB on the Pages project." }, 503);
  }
  // ---- CONFIG GUARD (fail closed) ----
  // Without SESSION_SECRET nothing can be signed or verified safely, so every route
  // except the static category list refuses to run.
  if (!(route === "categories" && method === "GET") && !env.SESSION_SECRET) {
    console.error("lookbook: SESSION_SECRET missing - refusing request to /api/" + route);
    return json({ error: "Sign-in is temporarily unavailable (server not configured)." }, 503);
  }

  try {
    await ensureUsersColumns(env);
    // ---- LOGIN ----
    if (route === "login" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const lastName = (body.lastName || "").toString().trim();
      const password = (body.password || "").toString();
      if (!lastName || !password) return json({ error: "Enter your last name and PIN." }, 400);

      const user = await env.DB
        .prepare("SELECT id,last_name,last4,role,name,project_ids,password_hash,must_change_password,email,active FROM users WHERE lower(last_name)=lower(?) OR lower(email)=lower(?)")
        .bind(lastName, lastName).first();
      if (!user) return json({ error: "Not recognized. Check your details or contact your rep." }, 401);
      if (user.active === 0) return json({ error: "This account has been deactivated. Contact your rep." }, 403);

      const firstTime = user.must_change_password || !user.password_hash;
      let ok = false;
      if (firstTime) {
        ok = password === String(user.last4);
      } else {
        ok = await verifyPassword(password, user.password_hash);
      }
      if (!ok) {
        return json({ error: firstTime
          ? "Not recognized. First-time sign-in uses your PIN (last 4 digits of your phone)."
          : "Incorrect PIN." }, 401);
      }
      const token = await makeToken(secretOf(env), user.id);
      return json({ ok: true, mustChange: !!firstTime, user: publicUser(user), token }, 200, {
        "set-cookie": cookieHeader(token),
      });
    }

    // ---- SET / CHANGE PASSWORD ----
    if (route === "set-password" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const teamLastName = (body.lastName || "").toString().trim();

      // The CRM sends { lastName, current, next }; older callers send newPassword.
      const nextPw = (body.newPassword || body.next || "").toString();
      const currentPw = (body.current || body.currentPassword || "").toString();
      if (teamLastName) {
        const gate = await teamAuth(request, env);
        if (!gate.configured) return json({ ok: false, error: "Team auth not configured on this project." }, 403);
        if (!gate.ok) return json({ ok: false, error: "Unauthorized caller." }, 401);
        const issue = passwordIssue(nextPw);
        if (issue) return json({ ok: false, error: `Password needs ${issue}.` }, 400);
        const user = await env.DB
          .prepare("SELECT id,last4,password_hash,must_change_password,active FROM users WHERE lower(last_name)=lower(?)")
          .bind(teamLastName).first();
        if (!user) return json({ ok: false, error: "User not found." }, 404);
        if (user.active === 0) return json({ ok: false, error: "This account has been deactivated." }, 403);
        if (!currentPw || !(await currentPasswordOk(user, currentPw))) {
          return json({ ok: false, error: "Current password is incorrect." }, 403);
        }
        const newPassword = nextPw;
        const hash = await hashPassword(newPassword);
        await env.DB
          .prepare("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?")
          .bind(hash, user.id).run();
        return json({ ok: true });
      }

      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in first." }, 401);
      // First-time setup (signed in with the PIN, must_change) needs no current
      // password; every later change must prove the current one.
      if (!user.must_change_password && user.password_hash) {
        if (!currentPw || !(await verifyPassword(currentPw, user.password_hash))) {
          return json({ error: "Current password is incorrect." }, 403);
        }
      }
      const issue = passwordIssue(nextPw);
      if (issue) return json({ error: `Password needs ${issue}.` }, 400);
      const hash = await hashPassword(nextPw);
      await env.DB
        .prepare("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?")
        .bind(hash, user.id).run();
      user.password_hash = hash;
      user.must_change_password = 0;
      return json({ ok: true, user: publicUser(user) });
    }

    // ---- LOGOUT ----
    if (route === "logout" && method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
    }

    // ---- ME ----
    if (route === "me" && method === "GET") {
      const user = await currentUser(context);
      return json({ user: user ? publicUser(user) : null });
    }

    // ---- VALIDATE ----
    if (route === "validate" && method === "POST") {
      const gate = await teamAuth(request, env);
      if (!gate.ok) return json({ valid: false, error: gate.configured ? "Unauthorized caller." : "Team auth not configured on this project." }, gate.configured ? 401 : 403);
      const body = await request.json().catch(() => ({}));
      const lastName = (body.lastName || "").toString().trim();
      const password = (body.password || "").toString();
      if (!lastName || !password) return json({ valid: false, error: "Missing credentials." }, 400);
      const user = await env.DB
        .prepare("SELECT id,last_name,last4,role,name,project_ids,password_hash,must_change_password,email,active FROM users WHERE lower(last_name)=lower(?) OR lower(email)=lower(?)")
        .bind(lastName, lastName).first();
      if (!user) return json({ valid: false });
      if (user.active === 0) return json({ valid: false, deactivated: true });
      const firstTime = user.must_change_password || !user.password_hash;
      const ok = firstTime ? (password === String(user.last4)) : await verifyPassword(password, user.password_hash);
      if (!ok) return json({ valid: false });
      return json({ valid: true, mustChange: !!firstTime, user: publicUser(user) });
    }

    // ---- COMMENTS ----
    if (route === "comments") {
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (user.must_change_password) return json({ error: "Set your password first." }, 403);

      if (method === "GET") {
        const pid = (url.searchParams.get("project") || "").trim();
        if (!pid || !canAccess(user, pid)) return json({ error: "No access to this project." }, 403);
        const { results } = await env.DB
          .prepare("SELECT author_name,role,type,text,created_at FROM comments WHERE project_id=? ORDER BY created_at ASC")
          .bind(pid).all();
        return json({ comments: results || [] });
      }
      if (method === "POST") {
        const body = await request.json().catch(() => ({}));
        const pid = (body.project || "").toString().trim();
        if (!pid || !canAccess(user, pid)) return json({ error: "No access to this project." }, 403);
        const text = (body.text || "").toString().trim().slice(0, 2000);
        if (!text) return json({ error: "Message is empty." }, 400);
        const type = body.type === "request" ? "request" : "comment";
        const now = new Date().toISOString();
        const author = user.name || user.last_name;
        await env.DB
          .prepare("INSERT INTO comments (project_id,author_name,role,type,text,created_at) VALUES (?,?,?,?,?,?)")
          .bind(pid, author, user.role, type, text, now).run();
        return json({ ok: true, comment: { author_name: author, role: user.role, type, text, created_at: now } });
      }
    }

    // ---- CATEGORIES ----
    if (route === "categories" && method === "GET") {
      return json({ categories: LOOKBOOK_CATEGORIES });
    }

    // ---- PROJECT CONFIG (owner email + per-category visibility) ----
    // GET: any signed-in user (clients read their visibility). POST: team only.
    if (route === "project-config" && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const pid = (url.searchParams.get("project") || "").trim();
      if (!pid) return json({ error: "project required." }, 400);
      if (!canView(user, pid)) return json({ error: "No access to this project." }, 403);
      const proj = await env.DB.prepare("SELECT id,name,owner_email,category_vis,client_last_name FROM scope_projects WHERE id=?").bind(pid).first();
      if (!proj) return json({ error: "No such project." }, 404);
      return json({
        id: proj.id, name: proj.name,
        owner_email: isTeam(user) ? (proj.owner_email || null) : undefined,
        category_vis: safeJSON(proj.category_vis, null),
        client_last_name: proj.client_last_name || null,
        can_edit: canEditScope(user),
      });
    }
    if (route === "project-config" && method === "POST") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only — team members only." }, 403);
      const b = await request.json().catch(() => ({}));
      const pid = (b.project || "").toString().trim();
      if (!pid) return json({ error: "project required." }, 400);
      const exists = await env.DB.prepare("SELECT id FROM scope_projects WHERE id=?").bind(pid).first();
      if (!exists) return json({ error: "No such project." }, 404);
      const sets = [], binds = [];
      if (b.owner_email !== undefined) { sets.push("owner_email=?"); binds.push(String(b.owner_email || "").slice(0, 200)); }
      if (b.category_vis !== undefined) { sets.push("category_vis=?"); binds.push(JSON.stringify(b.category_vis || {})); }
      if (b.client_last_name !== undefined) { sets.push("client_last_name=?"); binds.push(String(b.client_last_name || "").slice(0, 120)); }
      if (b.name !== undefined) { sets.push("name=?"); binds.push(String(b.name).slice(0, 160)); }
      if (!sets.length) return json({ error: "Nothing to update." }, 400);
      sets.push("updated_at=?"); binds.push(new Date().toISOString());
      binds.push(pid);
      await env.DB.prepare("UPDATE scope_projects SET " + sets.join(", ") + " WHERE id=?").bind(...binds).run();
      return json({ ok: true });
    }

    // ---- NOTES / QUESTIONS: client submits -> saved + emailed to the project's rep (Resend) ----
    // Recipient: scope_projects.owner_email (the rep), else NOTES_TO, else the owner default.
    // Optional NOTES_CC (comma list). Sender: NOTES_FROM (must be on a Resend-verified domain).
    // No RESEND_API_KEY -> the note is still saved and the email is logged, never an error.
    if (route === "notes" && method === "POST") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const b = await request.json().catch(() => ({}));
      const pid = (b.project || "").toString().trim();
      const message = (b.message || "").toString().trim().slice(0, 4000);
      if (!pid || !message) return json({ error: "Project and message are required." }, 400);
      if (!canView(user, pid)) return json({ error: "No access to this project." }, 403);
      const proj = await env.DB.prepare("SELECT id,name,owner_email FROM scope_projects WHERE id=?").bind(pid).first();
      if (!proj) return json({ error: "No such project." }, 404);
      const to = (proj.owner_email || env.NOTES_TO || DEFAULT_OWNER_EMAIL).toString().trim();
      const cc = String(env.NOTES_CC || "").split(",").map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== to.toLowerCase());
      const from = env.NOTES_FROM || DEFAULT_NOTES_FROM;
      const author = user.name || user.last_name || "A client";
      const link = lookbookUrl(env) + "/";
      const subject = `New note on ${proj.name} — from ${author}`;
      const textBody = `${author} left a note / question on the ${proj.name} lookbook:\n\n${message}\n\nOpen the lookbook: ${link}\n\n— Sent from the Better Living Systems lookbook`;
      let saved = false;
      try {
        await env.DB.prepare("INSERT INTO comments (project_id,author_name,role,type,text,created_at) VALUES (?,?,?,?,?,?)")
          .bind(pid, author, user.role, "note", message, new Date().toISOString()).run();
        saved = true;
      } catch (e) { console.error("notes: could not save comment", String(e && e.message || e)); }
      if (!env.RESEND_API_KEY) {
        console.log("notes: RESEND_API_KEY not set - email NOT sent (logged only)", JSON.stringify({ project: pid, to, cc, from, subject }));
        return json({ ok: saved, saved, emailed: false, note: "Saved. Your rep will see it in the lookbook." });
      }
      try {
        const payload = { from, to: [to], subject, text: textBody };
        if (cc.length) payload.cc = cc;
        if (user.email) payload.reply_to = user.email;
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "authorization": "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) console.error("notes: Resend send failed", r.status, (await r.text().catch(() => "")).slice(0, 300));
        return json({ ok: saved || r.ok, saved, emailed: r.ok, error: r.ok ? undefined : ("Saved, but the email could not be sent (" + r.status + ").") });
      } catch (e) {
        console.error("notes: Resend error", String((e && e.message) || e));
        return json({ ok: saved, saved, emailed: false, error: "Saved, but the email could not be sent." });
      }
    }

    // ---- PROJECTS (CRM, DB-backed) ----
    if (route === "projects") {
      await ensureProjectsTable(env);
      if (method === "GET") {
        const gate = await teamAuth(request, env);
        const user = await currentUser(context);
        if (!gate.ok && !(user && user.role === "admin")) return json({ error: "Unauthorized." }, 401);
        const { results } = await env.DB.prepare("SELECT * FROM crm_projects ORDER BY updated_at DESC").all();
        return json({ projects: (results || []).map(rowToProject) });
      }
      if (method === "POST") {
        const gate = await teamAuth(request, env);
        if (!gate.ok) return json({ error: gate.configured ? "Unauthorized caller." : "Team auth not configured on this project." }, gate.configured ? 401 : 403);
        const b = await request.json().catch(() => ({}));
        const action = b.action === "remove" ? "remove" : "upsert";
        const addr = (b.address || "").toString().trim();
        const key = normAddress(addr);
        if (!key) return json({ error: "Address required for project consolidation." }, 400);
        const leadId = String(b.lead_id || "");
        const systems = Array.isArray(b.systems) ? b.systems.map(String) : [];
        const client = (b.client_name || "").toString().trim();
        const now = new Date().toISOString();
        const existing = await env.DB.prepare("SELECT * FROM crm_projects WHERE address_key=?").bind(key).first();

        if (action === "remove") {
          if (!existing) return json({ ok: true, removed: false });
          let items = safeJSON(existing.items, []).filter((it) => String(it.lead_id) !== leadId);
          if (!items.length) {
            await env.DB.prepare("DELETE FROM crm_projects WHERE address_key=?").bind(key).run();
            return json({ ok: true, deletedProject: true });
          }
          const mergedSys = [...new Set(items.flatMap((it) => it.systems || []))];
          const photos = safeJSON(existing.photos, []).filter((ph) => String(ph.lead_id) !== leadId);
          await env.DB.prepare("UPDATE crm_projects SET systems=?,items=?,photos=?,updated_at=? WHERE address_key=?")
            .bind(JSON.stringify(mergedSys), JSON.stringify(items), JSON.stringify(photos), now, key).run();
          return json({ ok: true, project_id: existing.id, removed: true });
        }

        if (existing) {
          let items = safeJSON(existing.items, []);
          const idx = items.findIndex((it) => String(it.lead_id) === leadId);
          const item = { lead_id: leadId, systems, value: Number(b.value) || 0, client_name: client, sold_at: now };
          if (idx >= 0) items[idx] = { ...items[idx], ...item }; else items.push(item);
          const mergedSys = [...new Set(items.flatMap((it) => it.systems || []))];
          await env.DB.prepare("UPDATE crm_projects SET client_name=CASE WHEN client_name IS NULL OR client_name='' THEN ? ELSE client_name END, systems=?, items=?, updated_at=? WHERE address_key=?")
            .bind(client, JSON.stringify(mergedSys), JSON.stringify(items), now, key).run();
          return json({ ok: true, project_id: existing.id, appended: true });
        }
        const id = "p-" + key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
        const items = [{ lead_id: leadId, systems, value: Number(b.value) || 0, client_name: client, sold_at: now }];
        await env.DB.prepare("INSERT INTO crm_projects (id,address_key,client_name,address,systems,items,photos,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(id, key, client, addr, JSON.stringify(systems), JSON.stringify(items), JSON.stringify([]), now, now).run();
        return json({ ok: true, project_id: id, created: true });
      }
    }

    // ---- CREATE USER (team-auth) ----
    if (route === "users" && method === "POST") {
      const gate = await teamAuth(request, env);
      if (!gate.ok) return json({ error: gate.configured ? "Unauthorized caller." : "Team auth not configured on this project." }, gate.configured ? 401 : 403);
      const b = await request.json().catch(() => ({}));
      const name = (b.name || "").toString().trim();
      const email = (b.email || "").toString().trim().toLowerCase();
      const lastName = (b.last_name || "").toString().trim() || (name ? name.split(/\s+/).slice(-1)[0] : "");
      const role = ["admin", "sales", "client"].includes(b.role) ? b.role : "client";
      const projectIds = (b.project_ids || "").toString().trim();
      const last4 = (b.last4 || "").toString().replace(/\D/g, "").slice(-4);
      if (!name && !email) return json({ error: "A name or email is required." }, 400);
      if (email) {
        const dup = await env.DB.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").bind(email).first();
        if (dup) return json({ error: "A user with that email already exists.", user_id: dup.id }, 409);
      }
      const res = await env.DB
        .prepare("INSERT INTO users (last_name,last4,role,name,project_ids,email,must_change_password) VALUES (?,?,?,?,?,?,1)")
        .bind(lastName || "", last4 || "", role, name || "", projectIds || "", email || null).run();
      const uid = res.meta.last_row_id;
      // Persist the id so the row has a stable, non-null identifier (the token/session use it).
      try { await env.DB.prepare("UPDATE users SET id = CAST(? AS TEXT) WHERE rowid = ?").bind(uid, uid).run(); } catch(e){}
      const token = await makeInviteToken(secretOf(env), uid);
      const accept_url = lookbookUrl(env) + "/invite.html?token=" + encodeURIComponent(token);
      return json({ ok: true, user_id: uid, role, token, accept_url });
    }

    // ---- DEACTIVATE / REACTIVATE USER (team-auth) ----
    if (route === "users/deactivate" && method === "POST") {
      const gate = await teamAuth(request, env);
      if (!gate.configured) return json({ ok: false, error: "Team auth not configured on this project." }, 403);
      if (!gate.ok) return json({ ok: false, error: "Unauthorized caller." }, 401);
      const b = await request.json().catch(() => ({}));
      const active = b.action === "reactivate" ? 1 : 0;
      let user = null;
      if (b.user_id != null && String(b.user_id).trim()) {
        user = await env.DB.prepare("SELECT id,name,email FROM users WHERE id=?").bind(String(b.user_id).trim()).first();
      } else if (b.email) {
        user = await env.DB.prepare("SELECT id,name,email FROM users WHERE lower(email)=lower(?)").bind(String(b.email).trim()).first();
      } else if (b.last_name) {
        user = await env.DB.prepare("SELECT id,name,email FROM users WHERE lower(last_name)=lower(?)").bind(String(b.last_name).trim()).first();
      }
      if (!user) return json({ ok: false, error: "User not found." }, 404);
      await env.DB.prepare("UPDATE users SET active=? WHERE id=?").bind(active, user.id).run();
      return json({ ok: true, user_id: user.id, active });
    }

    // ---- ACCEPT INVITE ----
    if (route === "accept-invite" && method === "POST") {
      const b = await request.json().catch(() => ({}));
      const token = (b.token || "").toString();
      const newPassword = (b.newPassword || "").toString();
      const uid = await verifyInviteToken(secretOf(env), token);
      if (!uid) return json({ ok: false, error: "This invite link is invalid or has expired." }, 400);
      const issue = passwordIssue(newPassword);
      if (issue) return json({ ok: false, error: `Password needs ${issue}.` }, 400);
      const user = await env.DB.prepare("SELECT id,last_name,name,role,project_ids,password_hash,must_change_password,active FROM users WHERE id=?").bind(uid).first();
      if (!user) return json({ ok: false, error: "Account not found." }, 404);
      if (user.active === 0) return json({ ok: false, error: "This invite has been deactivated. Contact your rep." }, 403);
      const hash = await hashPassword(newPassword);
      await env.DB.prepare("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?").bind(hash, uid).run();
      const stoken = await makeToken(secretOf(env), user.id);
      return json({ ok: true, user: publicUser(user), token: stoken }, 200, { "set-cookie": cookieHeader(stoken) });
    }

    // ================= SCOPE VIEWER =================
    if (route === "scope" && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const pid = (url.searchParams.get("project") || "loomis-isleworth").trim();
      if (!canView(user, pid)) return json({ error: "No access to this project." }, 403);
      let proj = await env.DB.prepare("SELECT * FROM scope_projects WHERE id=?").bind(pid).first();
      if (!proj) {
        if (!canEditScope(user)) return json({ error: "No scope workspace for this project yet." }, 404);
        const nm = (url.searchParams.get("name") || pid).toString().slice(0,160);
        const now0 = new Date().toISOString();
        await env.DB.prepare("INSERT INTO scope_projects (id,name,created_at,updated_at) VALUES (?,?,?,?)").bind(pid, nm, now0, now0).run();
        proj = { id: pid, name: nm };
      }
      const { results } = await env.DB.prepare("SELECT * FROM scope_rooms WHERE project_id=? ORDER BY sort ASC, name ASC").bind(pid).all();
      return json({
        project: { id: proj.id, name: proj.name, owner_email: isTeam(user) ? (proj.owner_email || null) : null, category_vis: safeJSON(proj.category_vis, null) },
        can_edit: canEditScope(user),
        rooms: (results || []).map(rowToScopeRoom)
      });
    }
    if (route === "scope/room" && method === "POST") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only — ask a BLS team member to edit." }, 403);
      const b = await request.json().catch(() => ({}));
      const pid = (b.project || "loomis-isleworth").toString().trim();
      const now = new Date().toISOString();
      const id = "room-" + Date.now() + "-" + Math.floor(Math.random()*1000);
      const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM scope_rooms WHERE project_id=?").bind(pid).first();
      await env.DB.prepare("INSERT INTO scope_rooms (id,project_id,name,floor,drawing_url,scope_text,callouts,line_items,sort,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id, pid, (b.name||"New Room").toString().slice(0,120), (b.floor||null), null, "", "[]", "[]", (cnt&&cnt.n)||0, now, user.name||user.last_name).run();
      return json({ ok: true, id });
    }
    if (route === "scope/room" && method === "PUT") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only — ask a BLS team member to edit." }, 403);
      const b = await request.json().catch(() => ({}));
      const id = (b.id || "").toString().trim();
      if (!id) return json({ error: "Room id required." }, 400);
      const existing = await env.DB.prepare("SELECT id,updated_at FROM scope_rooms WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Room not found." }, 404);
      // Optimistic concurrency (same rule as PUT /scope/by-room/room).
      if (b.base_updated_at !== undefined && (existing.updated_at || null) !== (b.base_updated_at || null)) {
        return json({ error: "Someone else just updated this room. Reload to see their changes.", conflict: true, updated_at: existing.updated_at || null }, 409);
      }
      const now = new Date().toISOString();
      const callouts = JSON.stringify(Array.isArray(b.callouts) ? b.callouts : []);
      const lineItems = JSON.stringify(Array.isArray(b.line_items) ? b.line_items : []);
      await env.DB.prepare(`UPDATE scope_rooms SET
          name=COALESCE(?,name), floor=COALESCE(?,floor), drawing_url=?, scope_text=?, callouts=?, line_items=?, sort=COALESCE(?,sort),
          updated_at=?, updated_by=? WHERE id=?`)
        .bind(b.name!=null?String(b.name).slice(0,120):null, (b.floor!=null?String(b.floor).slice(0,40):null),
          b.drawing_url!=null?String(b.drawing_url).slice(0,1000):null,
          (b.scope_text!=null?String(b.scope_text):"").slice(0,20000), callouts, lineItems,
          b.sort!=null?Number(b.sort):null, now, user.name||user.last_name, id).run();
      return json({ ok: true, updated_at: now, updated_by: user.name||user.last_name });
    }
    if (route === "scope/room" && method === "DELETE") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only." }, 403);
      const id = (url.searchParams.get("id") || "").trim();
      if (!id) return json({ error: "Room id required." }, 400);
      await env.DB.prepare("DELETE FROM scope_rooms WHERE id=?").bind(id).run();
      return json({ ok: true });
    }

    if (route === "scope/projects" && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const { results } = await env.DB.prepare("SELECT id,name,updated_at,owner_email FROM scope_projects ORDER BY name ASC").all();
      const list = isTeam(user) ? (results || []) : (results || []).filter((p) => canView(user, p.id)).map((p) => ({ id: p.id, name: p.name, updated_at: p.updated_at }));
      return json({ projects: list, can_edit: canEditScope(user) });
    }
    if (route === "scope/project" && method === "POST") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only." }, 403);
      const b = await request.json().catch(() => ({}));
      const name = (b.name || "").toString().trim();
      if (!name) return json({ error: "Project name required." }, 400);
      let id = (b.id || name).toString().toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80) || ("scope-"+Date.now());
      const dup = await env.DB.prepare("SELECT id FROM scope_projects WHERE id=?").bind(id).first();
      if (dup) id = id + "-" + Date.now().toString(36);
      const now = new Date().toISOString();
      const ownerEmail = (b.owner_email || "corban@betterlivingsystems.com").toString().slice(0,200);
      const catVis = b.category_vis !== undefined ? JSON.stringify(b.category_vis) : null;
      const clientLast = (b.client_last_name || "").toString().slice(0,120) || null;
      await env.DB.prepare("INSERT INTO scope_projects (id,name,created_at,updated_at,owner_email,category_vis,client_last_name) VALUES (?,?,?,?,?,?,?)").bind(id, name, now, now, ownerEmail, catVis, clientLast).run();
      return json({ ok: true, id, name });
    }

    // ================= PROJECT SCOPE BY ROOM (scope.html) =================
    // Read-only room list + line items for any project. Team (admin/sales) can open
    // every project; a client only an assigned project whose "scope" card has been
    // made Visible on the dashboard. Never creates rows (unlike GET /scope).
    if (route === "scope/by-room" && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const pid = (url.searchParams.get("project") || "").trim();
      if (!pid) return json({ error: "project required." }, 400);
      const team = canEditScope(user);
      const proj = await env.DB.prepare("SELECT id,name,client_last_name,category_vis,scope_location,scope_footer,updated_at FROM scope_projects WHERE id=?").bind(pid).first();
      if (!team) {
        if (!canAccess(user, pid) || !proj) return json({ error: "No access to this project." }, 403);
        const vis = safeJSON(proj.category_vis, {}) || {};
        if (vis.scope !== true) return json({ error: "The scope for this project hasn't been shared yet." }, 403);
      }
      if (!proj) return json({ error: "No such project." }, 404);
      const { results } = await env.DB.prepare("SELECT id,name,floor,scope_text,line_items,sort,updated_at,updated_by FROM scope_rooms WHERE project_id=? ORDER BY sort ASC, name ASC").bind(pid).all();
      return json({
        project: { id: proj.id, name: proj.name, client_last_name: proj.client_last_name || null,
          location: proj.scope_location || null, footer: proj.scope_footer || null },
        can_edit: team,
        rooms: (results || []).map(r => ({ id: r.id, name: r.name, floor: r.floor || null, sort: r.sort || 0,
          note: r.scope_text || "", line_items: safeJSON(r.line_items, []),
          updated_at: r.updated_at || null, updated_by: r.updated_by || null })),
      });
    }
    // Narrow room update: only the fields sent (line_items / note / name / floor).
    // Leaves drawing_url + callouts untouched (the full PUT /scope/room overwrites them).
    // Optional base_updated_at → 409 if someone else saved the room in the meantime.
    if (route === "scope/by-room/room" && method === "PUT") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only — ask a BLS team member to edit." }, 403);
      const b = await request.json().catch(() => ({}));
      const id = (b.id || "").toString().trim();
      const pid = (b.project || "").toString().trim();
      if (!id || !pid) return json({ error: "Room id and project required." }, 400);
      const existing = await env.DB.prepare("SELECT id,updated_at FROM scope_rooms WHERE id=? AND project_id=?").bind(id, pid).first();
      if (!existing) return json({ error: "Room not found." }, 404);
      if (b.base_updated_at !== undefined && (existing.updated_at || null) !== (b.base_updated_at || null)) {
        return json({ error: "Someone else just updated this room. Reload to see their changes.", conflict: true }, 409);
      }
      const sets = [], binds = [];
      if (b.line_items !== undefined) {
        if (!Array.isArray(b.line_items)) return json({ error: "line_items must be an array." }, 400);
        const clean = b.line_items.slice(0, 500).map((li) => {
          const o = (li && typeof li === "object") ? li : {};
          const out = { ...o };
          out.category = String(o.category || "Other").slice(0, 60);
          out.item = String(o.item || "").slice(0, 300);
          out.qty = (o.qty === null || o.qty === "" || o.qty === undefined) ? null : Number(o.qty);
          if (out.qty !== null && !isFinite(out.qty)) out.qty = null;
          out.unit = String(o.unit || "ea").slice(0, 20);
          out.source = String(o.source || "ADDED").slice(0, 20);
          return out;
        });
        sets.push("line_items=?"); binds.push(JSON.stringify(clean));
      }
      if (b.note !== undefined) { sets.push("scope_text=?"); binds.push(String(b.note || "").slice(0, 20000)); }
      if (b.name !== undefined && String(b.name).trim()) { sets.push("name=?"); binds.push(String(b.name).trim().slice(0, 120)); }
      if (b.floor !== undefined) { sets.push("floor=?"); binds.push(b.floor ? String(b.floor).slice(0, 40) : null); }
      if (!sets.length) return json({ error: "Nothing to update." }, 400);
      const now = new Date().toISOString(), by = user.name || user.last_name;
      sets.push("updated_at=?", "updated_by=?"); binds.push(now, by, id, pid);
      await env.DB.prepare("UPDATE scope_rooms SET " + sets.join(", ") + " WHERE id=? AND project_id=?").bind(...binds).run();
      return json({ ok: true, updated_at: now, updated_by: by });
    }
    // Per-project header location + footer note for the scope view. Team only.
    if (route === "scope/by-room/project" && method === "PUT") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only." }, 403);
      const b = await request.json().catch(() => ({}));
      const pid = (b.project || "").toString().trim();
      if (!pid) return json({ error: "project required." }, 400);
      const exists = await env.DB.prepare("SELECT id FROM scope_projects WHERE id=?").bind(pid).first();
      if (!exists) return json({ error: "No such project." }, 404);
      const sets = [], binds = [];
      if (b.location !== undefined) { sets.push("scope_location=?"); binds.push(String(b.location || "").slice(0, 120)); }
      if (b.footer !== undefined) { sets.push("scope_footer=?"); binds.push(String(b.footer || "").slice(0, 4000)); }
      if (!sets.length) return json({ error: "Nothing to update." }, 400);
      binds.push(pid);
      await env.DB.prepare("UPDATE scope_projects SET " + sets.join(", ") + " WHERE id=?").bind(...binds).run();
      return json({ ok: true });
    }

    // ---- Scope plans ----
    if (route.startsWith("scope/plan/") && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const id = route.slice("scope/plan/".length);
      const row = await env.DB.prepare("SELECT project_id, mime, img FROM scope_plans WHERE id=?").bind(id).first();
      // Same 404 for "missing" and "not yours" so plan ids can't be probed.
      if (!row || !row.img || !canView(user, row.project_id)) return json({ error: "Not found." }, 404);
      const bytes = (row.img instanceof ArrayBuffer) ? new Uint8Array(row.img) : row.img;
      // private: per-user access, must not be stored by shared caches.
      return new Response(bytes, { headers: { "content-type": row.mime || "image/jpeg", "cache-control": "private, max-age=86400" } });
    }
    if (route === "scope/plans" && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const pid = (url.searchParams.get("project") || "loomis-isleworth").trim();
      if (!canView(user, pid)) return json({ error: "No access to this project." }, 403);
      const { results } = await env.DB.prepare("SELECT id, label, page_no FROM scope_plans WHERE project_id=? ORDER BY page_no ASC, created_at ASC").bind(pid).all();
      return json({ plans: (results||[]).map(r => ({ id:r.id, label:r.label, page_no:r.page_no, url:`/api/scope/plan/${r.id}` })) });
    }
    if (route === "scope/plan" && method === "POST") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only." }, 403);
      const b = await request.json().catch(() => ({}));
      const pid = (b.project || "loomis-isleworth").toString().trim();
      const dataUrl = (b.data_url || "").toString();
      const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
      if (!m) return json({ error: "Expected a base64 image data URL." }, 400);
      const mime = m[1]; const b64 = m[2];
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      if (bin.length > 950000) return json({ error: "Rendered page too large — downscale further (keep under ~0.9 MB).", size: bin.length }, 413);
      const id = "plan-" + Date.now().toString(36) + "-" + Math.floor(Math.random()*1000);
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO scope_plans (id,project_id,label,page_no,mime,img,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id, pid, (b.label||"Plan page").toString().slice(0,120), Number(b.page_no)||0, mime, bin, now, user.name||user.last_name).run();
      return json({ ok: true, id, url: `/api/scope/plan/${id}` });
    }
    if (route === "scope/assign-drawing" && method === "POST") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only." }, 403);
      const b = await request.json().catch(() => ({}));
      const pid = (b.project || "loomis-isleworth").toString().trim();
      const durl = (b.drawing_url || "").toString().slice(0,1000);
      if (!durl) return json({ error: "drawing_url required." }, 400);
      const now = new Date().toISOString();
      let n = 0;
      if (Array.isArray(b.room_ids) && b.room_ids.length) {
        for (const rid of b.room_ids) {
          const r = await env.DB.prepare("UPDATE scope_rooms SET drawing_url=?, updated_at=?, updated_by=? WHERE id=? AND project_id=?")
            .bind(durl, now, user.name||user.last_name, String(rid), pid).run();
          n += (r.meta && r.meta.changes) || 0;
        }
      } else if (b.floor) {
        const r = await env.DB.prepare("UPDATE scope_rooms SET drawing_url=?, updated_at=?, updated_by=? WHERE project_id=? AND floor=?")
          .bind(durl, now, user.name||user.last_name, pid, String(b.floor)).run();
        n = (r.meta && r.meta.changes) || 0;
      } else if (b.all) {
        const r = await env.DB.prepare("UPDATE scope_rooms SET drawing_url=?, updated_at=?, updated_by=? WHERE project_id=?")
          .bind(durl, now, user.name||user.last_name, pid).run();
        n = (r.meta && r.meta.changes) || 0;
      }
      return json({ ok: true, assigned: n });
    }


    // ---- Plans edit: legend + per-plan markup overlays (tables from migrations/0001_plans_edit.sql) ----
    if (route.startsWith("plans/")) {
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const who = user.name || user.last_name;
      const missing = (e) => /no such table/i.test(String((e && e.message) || e));
      const noCol = (e) => /no such column|has no column/i.test(String((e && e.message) || e));
      const notMigrated = () => json({ error: "Plans edit is not set up on this database yet (run migrations/0001_plans_edit.sql).", not_migrated: true }, 503);
      try {
        if (route === "plans/legend" && method === "GET") {
          let rows;
          try { rows = (await env.DB.prepare("SELECT id,name,color,icon,sort,wiring FROM plan_legend WHERE active=1 ORDER BY sort ASC, name ASC").all()).results; }
          catch (e) { if (!noCol(e)) throw e; rows = (await env.DB.prepare("SELECT id,name,color,icon,sort FROM plan_legend WHERE active=1 ORDER BY sort ASC, name ASC").all()).results; }
          const items = (rows || []).map((r) => ({ ...r, wiring: r.wiring ? safeJSON(r.wiring, null) : null }));
          return json({ items, can_edit: isTeam(user) }, 200, { "cache-control": "no-store" });
        }
        if (route === "plans/legend" && method === "POST") {
          if (!isTeam(user)) return json({ error: "View-only." }, 403);
          const b = await request.json().catch(() => ({}));
          const name = String(b.name || "").trim().slice(0, 60);
          const color = String(b.color || "").trim();
          const icon = String(b.icon || "").trim().slice(0, 24);
          if (!name) return json({ error: "Name required." }, 400);
          if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: "Colour must be #rrggbb." }, 400);
          if (!/^(text:[A-Za-z0-9+#&-]{1,3}|[a-z0-9-]{1,20})$/.test(icon)) return json({ error: "Unknown icon." }, 400);
          const hasW = b.wiring !== undefined;
          const wiring = hasW ? cleanWiring(b.wiring) : null;
          const now = new Date().toISOString();
          let id = String(b.id || "").trim();
          try {
            if (id) {
              const r = hasW
                ? await env.DB.prepare("UPDATE plan_legend SET name=?,color=?,icon=?,wiring=? WHERE id=?").bind(name, color, icon, wiring, id).run()
                : await env.DB.prepare("UPDATE plan_legend SET name=?,color=?,icon=? WHERE id=?").bind(name, color, icon, id).run();
              if (!((r.meta && r.meta.changes) || 0)) return json({ error: "Legend item not found." }, 404);
            } else {
              id = "lg-" + slugify(name).slice(0, 30) + "-" + Date.now().toString(36);
              const mx = await env.DB.prepare("SELECT COALESCE(MAX(sort),0) AS m FROM plan_legend").first();
              const so = ((mx && mx.m) || 0) + 10;
              if (hasW) await env.DB.prepare("INSERT INTO plan_legend (id,name,color,icon,wiring,sort,active,created_at,created_by) VALUES (?,?,?,?,?,?,1,?,?)")
                .bind(id, name, color, icon, wiring, so, now, who).run();
              else await env.DB.prepare("INSERT INTO plan_legend (id,name,color,icon,sort,active,created_at,created_by) VALUES (?,?,?,?,?,1,?,?)")
                .bind(id, name, color, icon, so, now, who).run();
            }
          } catch (e) {
            if (noCol(e)) return json({ error: "Wiring rules need the plan_legend.wiring column — re-run migrations/0001_plans_edit.sql on this database.", not_migrated: true }, 503);
            throw e;
          }
          return json({ ok: true, id, wiring: wiring ? JSON.parse(wiring) : null });
        }
        if (route === "plans/legend" && method === "DELETE") {
          if (!isTeam(user)) return json({ error: "View-only." }, 403);
          const id = (url.searchParams.get("id") || "").trim();
          // Soft delete so symbols already placed with this item still render.
          await env.DB.prepare("UPDATE plan_legend SET active=0 WHERE id=?").bind(id).run();
          return json({ ok: true });
        }
        if (route === "plans/markups" && method === "GET") {
          const pid = (url.searchParams.get("project") || "").trim();
          if (!canView(user, pid)) return json({ error: "No access to this project." }, 403);
          const { results } = await env.DB.prepare("SELECT plan_key,label,data,version,updated_at,updated_by FROM plan_markups WHERE project_id=?").bind(pid).all();
          return json({ markups: (results || []).map((r) => ({ ...r, data: safeJSON(r.data, { items: [] }) })), can_edit: isTeam(user) }, 200, { "cache-control": "no-store" });
        }
        if (route === "plans/markup" && method === "GET") {
          const pid = (url.searchParams.get("project") || "").trim();
          const key = (url.searchParams.get("plan") || "").trim();
          if (!canView(user, pid)) return json({ error: "No access to this project." }, 403);
          const r = await env.DB.prepare("SELECT plan_key,label,data,version,updated_at,updated_by FROM plan_markups WHERE project_id=? AND plan_key=?").bind(pid, key).first();
          let history = [];
          if (isTeam(user)) {
            const h = await env.DB.prepare("SELECT version,saved_at,saved_by FROM plan_markup_history WHERE project_id=? AND plan_key=? ORDER BY version DESC LIMIT 25").bind(pid, key).all();
            history = h.results || [];
          }
          return json({ markup: r ? { ...r, data: safeJSON(r.data, { items: [] }) } : null, history, can_edit: isTeam(user) }, 200, { "cache-control": "no-store" });
        }
        if ((route === "plans/markup" && method === "PUT") || (route === "plans/markup/restore" && method === "POST")) {
          if (!isTeam(user)) return json({ error: "View-only — ask a BLS team member to edit." }, 403);
          const b = await request.json().catch(() => ({}));
          const pid = String(b.project || "").trim();
          const key = String(b.plan || "").trim().slice(0, 1000);
          if (!pid || !key) return json({ error: "project and plan required." }, 400);
          const proj = await env.DB.prepare("SELECT id FROM scope_projects WHERE id=?").bind(pid).first();
          if (!proj) return json({ error: "Project not found." }, 404);
          const cur = await env.DB.prepare("SELECT data,version,label FROM plan_markups WHERE project_id=? AND plan_key=?").bind(pid, key).first();
          let data;
          if (route === "plans/markup/restore") {
            const h = await env.DB.prepare("SELECT data FROM plan_markup_history WHERE project_id=? AND plan_key=? AND version=?").bind(pid, key, Number(b.version) || 0).first();
            if (!h) return json({ error: "That version is no longer kept." }, 404);
            data = safeJSON(h.data, { items: [] });
          } else {
            const curV = cur ? cur.version : 0;
            if (b.base_version !== undefined && b.base_version !== null && Number(b.base_version) !== curV) {
              return json({ error: "Someone else saved this plan since you opened it. Reload to see their changes.", conflict: true, version: curV }, 409);
            }
            data = b.data;
          }
          const clean = cleanMarkup(data);
          if (!clean) return json({ error: "Invalid markup." }, 400);
          const text = JSON.stringify(clean);
          if (text.length > 400000) return json({ error: "Markup too large." }, 413);
          const now = new Date().toISOString();
          const nextV = (cur ? cur.version : 0) + 1;
          const label = String(b.label || (cur && cur.label) || "").slice(0, 120);
          const stmts = [];
          if (cur) stmts.push(env.DB.prepare("INSERT INTO plan_markup_history (project_id,plan_key,version,data,saved_at,saved_by) VALUES (?,?,?,?,?,?)").bind(pid, key, cur.version, cur.data, now, who));
          stmts.push(env.DB.prepare(`INSERT INTO plan_markups (project_id,plan_key,label,data,version,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(project_id,plan_key) DO UPDATE SET label=excluded.label,data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
            .bind(pid, key, label, text, nextV, now, who));
          stmts.push(env.DB.prepare(`DELETE FROM plan_markup_history WHERE project_id=? AND plan_key=? AND id NOT IN
              (SELECT id FROM plan_markup_history WHERE project_id=? AND plan_key=? ORDER BY version DESC LIMIT 25)`).bind(pid, key, pid, key));
          await env.DB.batch(stmts);
          return json({ ok: true, version: nextV, updated_at: now, updated_by: who, data: clean });
        }
      } catch (e) {
        if (missing(e)) return notMigrated();
        throw e;
      }
    }

    return json({ error: "Not found." }, 404);
  } catch (e) {
    return json({ error: "Server error.", detail: String((e && e.message) || e) }, 500);
  }
}
