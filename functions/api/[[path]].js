// Lookbook portal API — Cloudflare Pages Functions + D1
// Routes: /api/login, /api/logout, /api/me, /api/set-password, /api/comments
//
// Auth model:
// - First login uses last name + last-4-of-phone (the "PIN"), then the app forces the
//   user to set a real password (min 8, upper, lower, number). Passwords are stored as
//   PBKDF2-SHA256 hashes (never plaintext).
// - Subsequent logins use last name + the new password.
// - Roles: admin (all projects), sales (assigned), client (assigned + can comment/request).
//   NOTE: still gate only non-sensitive project collaboration behind this.

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

function passwordIssue(pw) {
  pw = String(pw || "");
  if (pw.length < 8) return "at least 8 characters";
  if (!/[a-z]/.test(pw)) return "a lowercase letter";
  if (!/[A-Z]/.test(pw)) return "an uppercase letter";
  if (!/[0-9]/.test(pw)) return "a number";
  return null;
}

function secretOf(env) {
  return env.SESSION_SECRET || "dev-insecure-secret-set-SESSION_SECRET";
}
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
  const uid = await verifyToken(secretOf(context.env), parseCookies(context.request)[COOKIE]);
  if (!uid || !context.env.DB) return null;
  const u = await context.env.DB
    .prepare("SELECT id,last_name,name,role,project_ids,password_hash,must_change_password,active FROM users WHERE id=?")
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

// Shared team-auth gate for cross-app (CRM) endpoints. Compares the caller's
// "x-team-auth" header against env.TEAM_AUTH_KEY in constant time (via HMAC so
// differing lengths don't leak). Returns { configured, ok }:
//   configured=false → no TEAM_AUTH_KEY set on this project.
//   ok=true → header matches the secret.
async function teamAuth(request, env) {
  if (!env.TEAM_AUTH_KEY) return { configured: false, ok: false };
  const provided = request.headers.get("x-team-auth") || "";
  if (!provided) return { configured: true, ok: false }; // missing header → clean reject (no HMAC on empty key)
  const ok = timingSafeEqualHex(
    await hmacHex(env.TEAM_AUTH_KEY, "k"),
    await hmacHex(provided, "k")
  );
  return { configured: true, ok };
}

// ---- Lookbook system categories (authoritative list; CRM reads via /api/categories) ----
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
// ---- Scope viewer (room-by-room proposal) persistence ----
// A scope project (e.g. Loomis Isleworth) has rooms; each room = one drawing +
// free-text scope + an array of pinned call-outs {label,measurement,products,x,y}.
// Call-outs are stored as a JSON blob on the room row (whole-room save keeps the
// collaborative read/write simple: GET the project, PUT a room).
// The real Loomis Isleworth room list, grouped by floor (Main / Upper / Exterior).
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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scope_rooms (
    id TEXT PRIMARY KEY, project_id TEXT, name TEXT, floor TEXT, drawing_url TEXT,
    scope_text TEXT, callouts TEXT, line_items TEXT, sort INTEGER DEFAULT 0,
    updated_at TEXT, updated_by TEXT
  )`).run();
  // Add newer columns on pre-existing DBs (ignore if they already exist).
  try { await env.DB.prepare("ALTER TABLE scope_rooms ADD COLUMN floor TEXT").run(); } catch(e){}
  try { await env.DB.prepare("ALTER TABLE scope_rooms ADD COLUMN line_items TEXT").run(); } catch(e){}
  // Small key/value table for one-time scope migrations.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scope_meta (key TEXT PRIMARY KEY, value TEXT)`).run();
  const now = new Date().toISOString();
  // Ensure the project row exists.
  const proj = await env.DB.prepare("SELECT id FROM scope_projects WHERE id=?").bind("loomis-isleworth").first();
  if (!proj) {
    await env.DB.prepare("INSERT INTO scope_projects (id,name,created_at,updated_at) VALUES (?,?,?,?)")
      .bind("loomis-isleworth","Loomis Isleworth",now,now).run();
  }
  // One-time seed of the real 49-room list (replaces the earlier placeholder rooms).
  const flag = await env.DB.prepare("SELECT value FROM scope_meta WHERE key=?").bind("isleworth_rooms_v2").first();
  if (!flag) {
    await env.DB.prepare("DELETE FROM scope_rooms WHERE project_id=?").bind("loomis-isleworth").run();
    let sort = 0;
    for (const grp of LOOMIS_FLOORS) {
      for (const name of grp.rooms) {
        const id = "room-" + slugify(grp.floor) + "-" + slugify(name);
        await env.DB.prepare("INSERT INTO scope_rooms (id,project_id,name,floor,drawing_url,scope_text,callouts,sort,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(id, "loomis-isleworth", name, grp.floor, null, "", "[]", sort++, now).run();
      }
    }
    await env.DB.prepare("INSERT INTO scope_meta (key,value) VALUES (?,?)").bind("isleworth_rooms_v2", now).run();
  }
}
function rowToScopeRoom(r){
  return { id:r.id, project_id:r.project_id, name:r.name, floor:r.floor||null, drawing_url:r.drawing_url||null,
    scope_text:r.scope_text||"", callouts:safeJSON(r.callouts,[]), line_items:safeJSON(r.line_items,[]), sort:r.sort||0,
    updated_at:r.updated_at, updated_by:r.updated_by||null };
}
// Editing the scope is for working staff (admin/sales); clients are view-only.
function canEditScope(user){ return !!user && (user.role === "admin" || user.role === "sales"); }
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
  // Soft-deactivation flag (default active). Lets the CRM disable a login (e.g. clean up test invites).
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1").run(); } catch(e){}
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

  try {
    await ensureUsersColumns(env);
    // ---- LOGIN (last name + password; password = last-4 PIN on first login) ----
    if (route === "login" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const lastName = (body.lastName || "").toString().trim();
      const password = (body.password || "").toString();
      if (!lastName || !password) return json({ error: "Enter your last name and password." }, 400);

      const user = await env.DB
        .prepare("SELECT id,last_name,last4,role,name,project_ids,password_hash,must_change_password,email,active FROM users WHERE lower(last_name)=lower(?) OR lower(email)=lower(?)")
        .bind(lastName, lastName).first();
      if (!user) return json({ error: "Not recognized. Check your details or contact your rep." }, 401);
      if (user.active === 0) return json({ error: "This account has been deactivated. Contact your rep." }, 403);

      const firstTime = user.must_change_password || !user.password_hash;
      let ok = false;
      if (firstTime) {
        ok = password === String(user.last4); // first-time credential
      } else {
        ok = await verifyPassword(password, user.password_hash);
      }
      if (!ok) {
        return json({ error: firstTime
          ? "Not recognized. First-time sign-in uses the last 4 digits of your phone."
          : "Incorrect password." }, 401);
      }
      const token = await makeToken(secretOf(env), user.id);
      return json({ ok: true, mustChange: !!firstTime, user: publicUser(user) }, 200, {
        "set-cookie": cookieHeader(token),
      });
    }

    // ---- SET / CHANGE PASSWORD ----
    // Two modes on the same URL:
    //   A) TEAM WRITE (cross-app, e.g. the bls-sales CRM): body includes "lastName".
    //      Requires the x-team-auth shared-secret gate. Writes to that user's
    //      password_hash so a change made on either app stays in sync. Sets no cookie.
    //   B) SELF-SERVICE (the lookbook's own forced-password-change): body has only
    //      "newPassword"; the signed-in user (cookie) is the target.
    if (route === "set-password" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const newPassword = (body.newPassword || "").toString();
      const teamLastName = (body.lastName || "").toString().trim();

      // --- Mode A: team write (identified by a lastName in the body) ---
      if (teamLastName) {
        const gate = await teamAuth(request, env);
        if (!gate.configured) return json({ ok: false, error: "Team auth not configured on this project." }, 403);
        if (!gate.ok) return json({ ok: false, error: "Unauthorized caller." }, 401);
        const issue = passwordIssue(newPassword);
        if (issue) return json({ ok: false, error: `Password needs ${issue}.` }, 400);
        const user = await env.DB
          .prepare("SELECT id FROM users WHERE lower(last_name)=lower(?)")
          .bind(teamLastName).first();
        if (!user) return json({ ok: false, error: "User not found." }, 404);
        const hash = await hashPassword(newPassword);
        await env.DB
          .prepare("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?")
          .bind(hash, user.id).run();
        return json({ ok: true });
      }

      // --- Mode B: self-service (must be signed in) ---
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in first." }, 401);
      const issue = passwordIssue(newPassword);
      if (issue) return json({ error: `Password needs ${issue}.` }, 400);
      const hash = await hashPassword(newPassword);
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

    // ---- VALIDATE (shared team-auth for other apps, e.g. the bls-sales CRM) ----
    // Stateless credential check against the SAME users table. Sets no cookie.
    // Intended for server-to-server calls (the CRM Worker) or a same-account Worker
    // that binds this D1 directly. If env.TEAM_AUTH_KEY is set, require a matching
    // "x-team-auth" header so the endpoint isn't openly callable; if unset, it behaves
    // like /api/login (same exposure). Non-destructive: does not modify any row.
    if (route === "validate" && method === "POST") {
      const gate = await teamAuth(request, env);
      if (gate.configured && !gate.ok) return json({ valid: false, error: "Unauthorized caller." }, 401);
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

    // ---- CATEGORIES (public: authoritative system list for the CRM checkboxes) ----
    if (route === "categories" && method === "GET") {
      return json({ categories: LOOKBOOK_CATEGORIES });
    }

    // ---- PROJECTS (DB-backed; consolidated by normalized address) ----
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
        if (gate.configured && !gate.ok) return json({ error: "Unauthorized caller." }, 401);
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

        // upsert (create or append this lead's systems)
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

    // ---- CREATE USER (team-auth): provision a user for an emailed invite ----
    if (route === "users" && method === "POST") {
      const gate = await teamAuth(request, env);
      if (gate.configured && !gate.ok) return json({ error: "Unauthorized caller." }, 401);
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
      const token = await makeInviteToken(secretOf(env), uid);
      const accept_url = new URL(request.url).origin + "/invite.html?token=" + encodeURIComponent(token);
      return json({ ok: true, user_id: uid, role, token, accept_url });
    }

    // ---- DEACTIVATE / REACTIVATE USER (team-auth): soft-disable a login ----
    // Used by the CRM admin Users list (e.g. to clean up test invites). Sets the
    // users.active flag; deactivated users can no longer log in or use a cookie.
    // Body: { user_id } | { email } | { last_name }, optional { action: "reactivate" }.
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

    // ---- ACCEPT INVITE (public; signed-token gated): set password from the emailed link ----
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
      return json({ ok: true, user: publicUser(user) }, 200, { "set-cookie": cookieHeader(stoken) });
    }

    // ================= SCOPE VIEWER (room-by-room proposal) =================
    // Read a scope project (rooms + scope + call-outs). Any signed-in user.
    if (route === "scope" && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const pid = (url.searchParams.get("project") || "loomis-isleworth").trim();
      let proj = await env.DB.prepare("SELECT * FROM scope_projects WHERE id=?").bind(pid).first();
      if (!proj) {
        // Reusable per-project tool: first visit lazily creates an empty scope workspace.
        if (!canEditScope(user)) return json({ error: "No scope workspace for this project yet." }, 404);
        const nm = (url.searchParams.get("name") || pid).toString().slice(0,160);
        const now0 = new Date().toISOString();
        await env.DB.prepare("INSERT INTO scope_projects (id,name,created_at,updated_at) VALUES (?,?,?,?)").bind(pid, nm, now0, now0).run();
        proj = { id: pid, name: nm };
      }
      const { results } = await env.DB.prepare("SELECT * FROM scope_rooms WHERE project_id=? ORDER BY sort ASC, name ASC").bind(pid).all();
      return json({
        project: { id: proj.id, name: proj.name },
        can_edit: canEditScope(user),
        rooms: (results || []).map(rowToScopeRoom)
      });
    }
    // Create a room. Team only.
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
    // Update a room (name / drawing_url / scope_text / callouts). Team only.
    if (route === "scope/room" && method === "PUT") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      if (!canEditScope(user)) return json({ error: "View-only — ask a BLS team member to edit." }, 403);
      const b = await request.json().catch(() => ({}));
      const id = (b.id || "").toString().trim();
      if (!id) return json({ error: "Room id required." }, 400);
      const existing = await env.DB.prepare("SELECT id FROM scope_rooms WHERE id=?").bind(id).first();
      if (!existing) return json({ error: "Room not found." }, 404);
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
    // Delete a room. Team only.
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

    // List all scope projects (for the project switcher). Any signed-in user.
    if (route === "scope/projects" && method === "GET") {
      await ensureScopeTables(env);
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in." }, 401);
      const { results } = await env.DB.prepare("SELECT id,name,updated_at FROM scope_projects ORDER BY name ASC").all();
      return json({ projects: results || [], can_edit: canEditScope(user) });
    }
    // Create a new scope project (reusable tool). Team only.
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
      await env.DB.prepare("INSERT INTO scope_projects (id,name,created_at,updated_at) VALUES (?,?,?,?)").bind(id, name, now, now).run();
      return json({ ok: true, id, name });
    }

    return json({ error: "Not found." }, 404);
  } catch (e) {
    return json({ error: "Server error.", detail: String((e && e.message) || e) }, 500);
  }
}
