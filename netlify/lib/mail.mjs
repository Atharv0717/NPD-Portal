import nodemailer from "nodemailer";

const env = (k) => Netlify.env.get(k);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const mailReady = () => !!(env("MAIL_USER") && env("MAIL_PASS"));
export const smsReady = () => !!(env("TWILIO_SID") && env("TWILIO_TOKEN") && env("TWILIO_FROM"));

// meeting time: saved by the browser as epoch ms (ts); older meetings fall back to text + TZ_OFFSET
export const startMs = (m) => m.ts || new Date(m.at + ":00" + (env("TZ_OFFSET") || "+05:30")).getTime();
export const when = (ts) =>
  new Date(ts).toLocaleString("en-IN", { timeZone: env("TIMEZONE") || "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });

// who gets the email: the user's own email (if switched on) + any extra emails typed in the meeting
export const recipients = (m, user) =>
  [...new Set([...(user && user.ne !== false ? [user.email] : []), ...(m.em || "").split(/[,;\s]+/)].filter((x) => /^\S+@\S+\.\S+$/.test(x || "")))];

const phone = (p) => {
  p = String(p || "").replace(/[\s\-()]/g, "");
  return /^\d{10}$/.test(p) ? (env("SMS_COUNTRY") || "+91") + p : p;
};

export async function sendMail(to, subject, html) {
  const tr = nodemailer.createTransport({ service: "gmail", auth: { user: env("MAIL_USER"), pass: env("MAIL_PASS") } });
  await tr.sendMail({ from: `"NPD Portal" <${env("MAIL_USER")}>`, to: to.join(","), subject, html });
}

export async function sendSms(to, text) {
  const sid = env("TWILIO_SID");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(sid + ":" + env("TWILIO_TOKEN")).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: phone(to), From: env("TWILIO_FROM"), Body: text }),
  });
  if (!r.ok) throw new Error("SMS error " + r.status + " " + (await r.text()).slice(0, 150));
}

const info = (m, db) => {
  const ts = startMs(m);
  const mahle = (m.ty || (m.c === "mahle" ? "mahle" : "cust")) === "mahle";
  return {
    ts,
    label: mahle ? "Mahle Meeting" : "Customer Meeting",
    cust: ((db.cust || []).find((c) => c.id === m.c) || {}).name || "",
    proj: ((db.proj || []).find((p) => p.id === m.p) || {}).n || "",
    docs: (db.docs || []).filter((f) => (m.p ? f.p === m.p : f.c === m.c && !f.p)).slice(0, 15).map((f) => f.name),
  };
};

export async function sendMeetingMail(m, db, kind, user) {
  const to = recipients(m, user);
  if (!to.length) throw new Error("no recipient");
  const { ts, label, cust, proj, docs } = info(m, db);
  const site = env("URL") || "";
  const intro = {
    scheduled: "A meeting has been scheduled.",
    updated: "A meeting has been updated / rescheduled.",
    remind24: "REMINDER: this meeting is within the next 24 hours. Please prepare.",
    remind2: "REMINDER: this meeting starts in about 2 hours. Please be ready.",
  }[kind];
  const head = {
    scheduled: "Meeting scheduled: ",
    updated: "Meeting updated: ",
    remind24: "Reminder (1 day before): ",
    remind2: "Reminder (2 hours before): ",
  }[kind];
  const prep = [
    "Read the agenda below and note your points and open actions.",
    "Keep the project documents ready (drawings, PFD, PFMEA, Control Plan, process sheet).",
    "Update the status, risks, cost / savings numbers and next actions.",
    "Collect pending customer or team queries to close in the meeting.",
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2328;max-width:620px">
<h2 style="margin:0 0 6px;color:#0b7a9e">${esc(m.title)}</h2><p style="margin:0 0 12px"><b>${esc(intro)}</b></p>
<table style="border-collapse:collapse"><tr><td style="padding:3px 14px 3px 0"><b>Type</b></td><td>${label}</td></tr>
<tr><td style="padding:3px 14px 3px 0"><b>Customer</b></td><td>${esc(cust)}</td></tr>
${proj ? `<tr><td style="padding:3px 14px 3px 0"><b>Project</b></td><td>${esc(proj)}</td></tr>` : ""}
<tr><td style="padding:3px 14px 3px 0"><b>Date &amp; time</b></td><td>${esc(when(ts))}</td></tr></table>
${m.g ? `<p><b>Agenda</b><br>${esc(m.g).replace(/\n/g, "<br>")}</p>` : ""}
<p><b>Please prepare</b></p><ul>${prep.map((x) => `<li>${x}</li>`).join("")}</ul>
${docs.length ? `<p><b>Documents on the portal</b></p><ul>${docs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${site ? `<p><a href="${esc(site)}">Open NPD Portal</a></p>` : ""}
<p style="color:#6b7280;font-size:12px">NPD Portal – Mahle · New Product Development</p></div>`;
  await sendMail(to, head + m.title + " – " + when(ts), html);
}

export async function sendMeetingSms(m, db, kind, user) {
  if (!user.phone) throw new Error("no phone");
  const { ts, label, cust } = info(m, db);
  const lead = { scheduled: "Meeting scheduled", updated: "Meeting updated", remind24: "Reminder - meeting within 24 hours, please prepare", remind2: "Reminder - meeting in about 2 hours" }[kind];
  await sendSms(user.phone, `NPD Portal: ${lead}. ${label}: ${m.title}${cust ? " (" + cust + ")" : ""}, ${when(ts)}.`);
}
