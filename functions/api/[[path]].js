// Lookbook portal API — Cloudflare Pages Functions + D1
// Routes: /api/login, /api/logout, /api/me, /api/set-password, /api/comments
//
// Auth model:
//  - First login uses last name + last-4-of-phone (the "PIN"), then the app forces the
//    user to set a real password (min 8, upper, lower, number). Passwords are stored as
//    PBKDF2-SHA256 hashes (never plaintext).
//  - Subsequent logins use last name + the new password.
//  - Roles: admin (all projects), sales (assigned), client (assigned + can comment/request).
//  NOTE: still gate only non-sensitive project collaboration behind this.

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
  return await context.env.DB
    .prepare("SELECT id,last_name,name,role,project_ids,password_hash,must_change_password FROM users WHERE id=?")
    .bind(uid).first();
}
function cookieHeader(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}
function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
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
    // ---- LOGIN (last name + password; password = last-4 PIN on first login) ----
    if (route === "login" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const lastName = (body.lastName || "").toString().trim();
      const password = (body.password || "").toString();
      if (!lastName || !password) return json({ error: "Enter your last name and password." }, 400);

      const user = await env.DB
        .prepare("SELECT id,last_name,last4,role,name,project_ids,password_hash,must_change_password FROM users WHERE lower(last_name)=lower(?)")
        .bind(lastName).first();
      if (!user) return json({ error: "Not recognized. Check your details or contact your rep." }, 401);

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

    // ---- SET / CHANGE PASSWORD (must be logged in) ----
    if (route === "set-password" && method === "POST") {
      const user = await currentUser(context);
      if (!user) return json({ error: "Please sign in first." }, 401);
      const body = await request.json().catch(() => ({}));
      const newPassword = (body.newPassword || "").toString();
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

    return json({ error: "Not found." }, 404);
  } catch (e) {
    return json({ error: "Server error.", detail: String((e && e.message) || e) }, 500);
  }
}
