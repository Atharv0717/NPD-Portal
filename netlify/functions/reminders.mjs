import { getStore } from "@netlify/blobs";
import { mailReady, smsReady, recipients, startMs, sendMeetingMail, sendMeetingSms } from "../lib/mail.mjs";

// runs every 10 minutes for EVERY user: reminder 1 day before and 2 hours before each meeting (email and/or SMS)
export default async () => {
  const useMail = mailReady(), useSms = smsReady();
  if (!useMail && !useSms) return;
  const store = getStore({ name: "npd", consistency: "strong" });
  const { blobs } = await store.list({ prefix: "users/" });
  const now = Date.now();
  for (const b of blobs) {
    const user = await store.get(b.key, { type: "json" });
    const db = user && (await store.get(`u/${user.u}/db`, { type: "json" }));
    if (!db || !db.meet) continue;
    for (const m of db.meet) {
      const t = startMs(m), left = t - now;
      if (!(left > 0 && left <= 864e5)) continue;
      const kind = left <= 72e5 ? "remind2" : "remind24";
      const key = `sent/${user.u}/${m.id}-${t}-${kind}`;
      if (await store.get(key)) continue;
      const jobs = [];
      if (useMail && recipients(m, user).length) jobs.push(sendMeetingMail(m, db, kind, user));
      if (useSms && user.phone && user.ns) jobs.push(sendMeetingSms(m, db, kind, user));
      if (!jobs.length) continue;
      const res = await Promise.allSettled(jobs);
      res.filter((r) => r.status === "rejected").forEach((r) => console.error("reminder failed:", user.u, m.title, String(r.reason)));
      if (res.some((r) => r.status === "fulfilled")) await store.set(key, "1");
    }
  }
};

export const config = { schedule: "*/10 * * * *" };
