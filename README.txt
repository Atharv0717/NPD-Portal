NPD PORTAL - separate login and private workspace for every user

WHAT IT DOES
- Sign up / Sign in: every user has own username + password (stored as a hash on the server) and a PRIVATE workspace.
  Projects, documents, meetings and messages of one user are never visible to another user.
- Projects (Mahle + Customer), Documents (view directly: images, video, audio, PDF, Excel/CSV, Word, PowerPoint text,
  text files; AutoCAD files download), Communication, Meetings (Mahle Meetings and Customer Meetings listed separately).
- Reminders for every meeting: 1 DAY before and 2 HOURS before, by EMAIL (free) and optional SMS.
  Also pop-up alerts on the website (1 day, 2 hours, 15 minutes before) and a Notifications card on the Dashboard.
- An email with the schedule is sent when a meeting is added or changed.
- Settings page: name, role, department, email, mobile, reminder on/off, "Send test email / SMS", change password.
- Sign out: bottom of the left sidebar.

FREE PLATFORM USED: Netlify (free plan) + GitHub (free). Storage, login, emails and the reminder timer all run inside Netlify
(Functions, Blobs, scheduled function). Gmail is used as the free email sender. Free-plan limits of Netlify apply.
(Other free hosts such as Vercel/GitHub Pages cannot run this without changing the storage code.)
For a completely separate website for another person/team: deploy the same zip again as a second Netlify site -
it has its own users and its own storage.

DEPLOY - STEPS (about 10 minutes)
1. Unzip. You must see: public/, netlify/ (functions + lib), netlify.toml, package.json, README.txt
2. github.com > New repository (npd-portal, Private) > upload ALL files and folders (keep the folders) > Commit.
3. app.netlify.com > log in with GitHub > Add new site > Import an existing project > GitHub > npd-portal > Deploy.
4. Site configuration > Environment variables > add (Add a variable > Same value for all deploy contexts):
     MAIL_USER  = the Gmail address that sends the reminders
     MAIL_PASS  = Gmail App Password (16 letters, no spaces) - see EMAIL SETUP
   Optional:
     SIGNUP_KEY = a secret code; if set, only people who know it can create an account (recommended)
     TIMEZONE   = default Asia/Kolkata        TZ_OFFSET = default +05:30
5. Deploys > Trigger deploy > Deploy site (needed after adding variables).
6. Open the xxxx.netlify.app link. Sign up (full name, role, department, EMAIL, mobile, username, password).
   Then Settings > "Send test email / SMS". Share the link with other users: each signs up and gets own workspace.
   If it says "Server not found", the netlify folder / package.json were not uploaded: upload them and redeploy.
   Old single-user version: the FIRST account created adopts the old data (projects, meetings, files).

EMAIL SETUP (free, Gmail)
1. Google Account > Security > turn on 2-Step Verification.
2. Google Account > Security > App passwords > name "NPD Portal" > Create > copy the 16 letters.
3. Netlify variables: MAIL_USER = your Gmail, MAIL_PASS = the 16 letters. Redeploy.
4. Each user puts own email in Settings. Reminders come from your Gmail (Gmail free sending limit applies; check Spam first time).

SMS SETUP (optional - SMS is NOT free everywhere; email is the free option)
SMS uses Twilio. A Twilio trial account gives free trial credit but can only send to phone numbers you have verified
in Twilio; sending to any number needs a paid account. In India, SMS may need extra operator registration (DLT) -
check Twilio's India SMS rules. Steps: create Twilio account > get a Twilio phone number > Netlify variables:
     TWILIO_SID = Account SID     TWILIO_TOKEN = Auth Token     TWILIO_FROM = your Twilio number (+...)
     SMS_COUNTRY = +91 (default; used when a user types a 10-digit mobile number)
Redeploy. Each user: Settings > mobile number > tick "SMS reminders" > Send test.

HOW REMINDERS WORK
A Netlify scheduled function ("reminders") runs every 10 minutes, checks every user's meetings and sends:
 - 1 day before (when the meeting is within 24 hours), and
 - 2 hours before.
Each reminder is sent once per meeting (rescheduled meeting = new reminders). A meeting created less than 2 hours
ahead gets only the 2-hour reminder. Scheduled functions run only on the published (production) deploy.
Netlify > Logs > Functions > reminders shows what ran.

NOTES
- Do not use the drag-and-drop "public only" deploy: login, storage and reminders need the netlify folder.
- Large files upload in 4 MB parts. PDF/Excel/Word viewers need internet.
- Time zone for emails: set TIMEZONE if users are not in India.
