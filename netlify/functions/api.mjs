import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { mailReady, mailFrom, smsReady, recipients, sendMail, sendSms, sendMeetingMail } from "../lib/mail.mjs";

const env = (k) => Netlify.env.get(k);
const safe = (x) => /^[A-Za-z0-9]{1,40}$/.test(x || "");

const hashPw = (pw, salt = crypto.randomBytes(16).toString("hex")) => salt + ":" + crypto.scryptSync(pw, salt, 32).toString("hex");
const checkPw = (pw, h) => {
  const [s, x] = String(h || "").split(":");
  if (!s || !x) return false;
  const y = crypto.scryptSync(pw, s, 32).toString("hex");
  return x.length === y.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y));
};
const pub = (u) => ({ u: u.u, name: u.name, role: u.role, dept: u.dept, email: u.email, phone: u.phone, ne: u.ne !== false, ns: !!u.ns });

export default async (req) => {
  const store = getStore({ name: "npd", consistency: "strong" });
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/api\//, "").split("/");
  const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const bad = (m, st = 400) => new Response(m, { status: st });
  try {
    let secret = await store.get("secret");
    if (!secret) { secret = crypto.randomBytes(32).toString("hex"); await store.set("secret", secret); }
    // built-in logins: created automatically the first time the site is opened.
    // Each person has their own private workspace and gets reminders at their own email.
    const su = String(env("ADMIN_USER") || "Supraman").toLowerCase();
    const seeds = [
      { u: su, name: env("ADMIN_NAME") || "Atharv Shete", email: env("ADMIN_EMAIL") || "atharvshete07@gmail.com", pw: env("ADMIN_PASS") || "Supraman@2026" },
      { u: String(env("USER2_USER") || "Sachin").toLowerCase(), name: env("USER2_NAME") || "Sachin Shete", email: env("USER2_EMAIL") || "sachinshetebs@gmail.com", pw: env("USER2_PASS") || "Sachin@2026" },
    ];
    for (const sd of seeds) {
      if (await store.get(`users/${sd.u}`)) continue;
      const first = (await store.list({ prefix: "users/" })).blobs.length === 0;
      const seedUser = { u: sd.u, name: sd.name, role: "Manager", dept: "", email: sd.email, phone: "", h: hashPw(sd.pw), ne: true, ns: false, at: Date.now() };
      if (first) { const old = await store.get("db", { type: "json" }); if (old) { delete old.users; await store.setJSON(`u/${sd.u}/db`, old); seedUser.legacy = true; } }
      await store.setJSON(`users/${sd.u}`, seedUser);
    }
    const sign = (u) => {
      const a = Buffer.from(JSON.stringify({ u, exp: Date.now() + 30 * 864e5 })).toString("base64url");
      return a + "." + crypto.createHmac("sha256", secret).update(a).digest("base64url");
    };
    const verify = (t) => {
      const [a, b] = String(t || "").split(".");
      if (!a || !b) return null;
      const c = crypto.createHmac("sha256", secret).update(a).digest("base64url");
      if (b.length !== c.length || !crypto.timingSafeEqual(Buffer.from(b), Buffer.from(c))) return null;
      try { const o = JSON.parse(Buffer.from(a, "base64url").toString()); return o.exp > Date.now() ? o.u : null; } catch { return null; }
    };

    const open = env("REQUIRE_LOGIN") === "0"; // default: sign-in page is required. Set REQUIRE_LOGIN=0 in Netlify only if you want the site to open without sign-in.
    if (p[0] === "config") return json({ invite: !!env("SIGNUP_KEY"), mail: mailReady(), sms: smsReady(), open, signup: env("ALLOW_SIGNUP") !== "0", tz: env("TIMEZONE") || "Asia/Kolkata" });
    if (p[0] === "auto" && req.method === "POST") {
      if (!open) return bad("Sign in required.", 401);
      const au = await store.get(`users/${su}`, { type: "json" });
      return json({ token: sign(su), me: pub(au) });
    }

    if (p[0] === "signup" && req.method === "POST") {
      if (env("ALLOW_SIGNUP") === "0") return bad("Sign up is turned off. Please sign in.", 403); // optional: set ALLOW_SIGNUP=0 in Netlify to turn sign up off
      const b = await req.json();
      const u = String(b.username || "").toLowerCase();
      if (!/^[a-z0-9_.]{3,30}$/.test(u)) return bad("Username: 3-30 letters, numbers, dot or underscore.");
      if (String(b.password || "").length < 6) return bad("Password must be at least 6 characters.");
      if (String(b.name || "").trim().length < 2) return bad("Enter your full name.");
      if (env("SIGNUP_KEY") && String(b.invite || "").trim() !== env("SIGNUP_KEY")) return bad("Wrong invite code.", 403);
      if (await store.get(`users/${u}`)) return bad("This username is already taken. Choose another.", 409);
      const first = (await store.list({ prefix: "users/" })).blobs.length === 0;
      const user = {
        u, name: String(b.name).trim(), role: String(b.role || "").trim() || "Member", dept: String(b.dept || "").trim(),
        email: String(b.email || "").trim(), phone: String(b.phone || "").trim(), h: hashPw(b.password), ne: true, ns: !!b.phone, at: Date.now(),
      };
      if (first) { // the first account adopts data saved by the older single-user version, if any
        const old = await store.get("db", { type: "json" });
        if (old) { delete old.users; await store.setJSON(`u/${u}/db`, old); user.legacy = true; }
      }
      await store.setJSON(`users/${u}`, user);
      return json({ token: sign(u), me: pub(user) });
    }

    if (p[0] === "login" && req.method === "POST") {
      const b = await req.json();
      const u = String(b.username || "").toLowerCase();
      const user = /^[a-z0-9_.]{3,30}$/.test(u) ? await store.get(`users/${u}`, { type: "json" }) : null;
      if (!user || !checkPw(String(b.password || ""), user.h)) return bad("Wrong username or password.", 401);
      return json({ token: sign(u), me: pub(user) });
    }

    // everything below needs a signed-in user; each user only ever sees their own data
    const u = verify((req.headers.get("authorization") || "").replace(/^Bearer /, ""));
    const user = u ? await store.get(`users/${u}`, { type: "json" }) : null;
    if (!user) return bad("unauthorized", 401);

    if (p[0] === "me") return json(pub(user));

    if (p[0] === "profile" && req.method === "POST") {
      const b = await req.json();
      for (const k of ["name", "role", "dept", "email", "phone"]) if (typeof b[k] === "string") user[k] = b[k].trim();
      if (user.name.length < 2) return bad("Enter your full name.");
      user.ne = !!b.ne; user.ns = !!b.ns;
      await store.setJSON(`users/${u}`, user);
      return json(pub(user));
    }

    if (p[0] === "password" && req.method === "POST") {
      const b = await req.json();
      if (!checkPw(String(b.old || ""), user.h)) return bad("Current password is wrong.", 403);
      if (String(b.pw || "").length < 6) return bad("New password must be at least 6 characters.");
      user.h = hashPw(b.pw);
      await store.setJSON(`users/${u}`, user);
      return json({ ok: 1 });
    }

    if (p[0] === "db") {
      if (req.method === "PUT") { await store.setJSON(`u/${u}/db`, await req.json()); return json({ ok: 1 }); }
      return json((await store.get(`u/${u}/db`, { type: "json" })) || {});
    }

    if (p[0] === "chunk") {
      if (!safe(p[1]) || !/^\d{1,4}$/.test(p[2] || "")) return bad("bad request");
      const key = `c/${u}/${p[1]}/${p[2]}`;
      if (req.method === "PUT") { await store.set(key, await req.arrayBuffer()); return json({ ok: 1 }); }
      let b = await store.get(key, { type: "arrayBuffer" });
      if (!b && user.legacy) b = await store.get(`c/${p[1]}/${p[2]}`, { type: "arrayBuffer" });
      return b ? new Response(b, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } }) : bad("not found", 404);
    }

    if (p[0] === "file" && req.method === "DELETE") {
      if (!safe(p[1])) return bad("bad request");
      const n = Math.min(Number(url.searchParams.get("n")) || 0, 2000);
      for (let i = 0; i < n; i++) { await store.delete(`c/${u}/${p[1]}/${i}`); if (user.legacy) await store.delete(`c/${p[1]}/${i}`); }
      return json({ ok: 1 });
    }

    if (p[0] === "mail" && req.method === "POST") {
      if (!mailReady()) return bad("the email service is not set up in Netlify yet (see README).");
      const { m, k } = await req.json();
      if (!recipients(m, user).length) return bad("add your email in Settings or in the meeting's Email box.");
      const db = (await store.get(`u/${u}/db`, { type: "json" })) || {};
      await sendMeetingMail(m, db, k === "updated" ? "updated" : "scheduled", user);
      return json({ ok: 1 });
    }

    if (p[0] === "test" && req.method === "POST") {
      const out = { email: "email service not set up", sms: "SMS service not set up (optional)" };
      if (mailReady()) {
        if (!user.email) out.email = "add your email first";
        else try { await sendMail([user.email], "NPD Portal – test email", "<p>Your email reminders are working.</p>"); out.email = "sent to " + user.email + " (sender: " + mailFrom() + ")"; } catch (e) { out.email = "failed (sender: " + mailFrom() + "): " + e.message; }
      }
      if (smsReady()) {
        if (!user.phone) out.sms = "add your mobile first";
        else try { await sendSms(user.phone, "NPD Portal: test SMS. Your SMS reminders are working."); out.sms = "sent to " + user.phone; } catch (e) { out.sms = "failed: " + e.message; }
      }
      return json(out);
    }
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
  return bad("not found", 404);
};

export const config = { path: "/api/*" };
