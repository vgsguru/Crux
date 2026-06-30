#!/usr/bin/env node
/**
 * Crux data reset — wipes app data for a clean slate.
 *
 *   node scripts/reset-data.cjs            # wipe content collections + storage
 *   node scripts/reset-data.cjs --all      # also wipe users, profiles, companies, usernames
 *   node scripts/reset-data.cjs --auth     # ALSO delete every Firebase Auth login
 *
 * Reads FIREBASE_SERVICE_ACCOUNT from .env. Destructive — there is no undo.
 */
const fs = require("fs");
const path = require("path");

function readEnv(key) {
  const txt = fs.readFileSync(path.resolve(__dirname, "..", ".env"), "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    return v;
  }
  return null;
}

const CONTENT = [
  "posts", "post_likes", "post_comments", "post_shares",
  "jobs", "applications", "interviews", "credentials",
  "reports", "recruitment_claims", "company_verifications",
  "notifications", "saved_jobs", "application_messages",
  "message_templates", "question_bank", "interview_templates",
  "interview_template_questions", "role_audit",
  "follows", "score_audits",
];
const IDENTITY = ["users", "profiles", "companies", "usernames"];

async function deleteCollection(db, name) {
  let total = 0;
  while (true) {
    const snap = await db.collection(name).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
  if (total) console.log(`  ${name}: deleted ${total}`);
}

(async () => {
  const sa = JSON.parse(readEnv("FIREBASE_SERVICE_ACCOUNT"));
  const { initializeApp, cert } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getStorage } = require("firebase-admin/storage");
  const { getAuth } = require("firebase-admin/auth");
  const app = initializeApp({ credential: cert(sa), projectId: sa.project_id, storageBucket: `${sa.project_id}.firebasestorage.app` });
  const db = getFirestore(app);

  const all = process.argv.includes("--all") || process.argv.includes("--auth");
  const wipeAuth = process.argv.includes("--auth");

  console.log("Wiping content collections…");
  for (const c of CONTENT) await deleteCollection(db, c);

  if (all) {
    console.log("Wiping identity collections…");
    for (const c of IDENTITY) await deleteCollection(db, c);
  }

  try {
    console.log("Wiping Storage…");
    await getStorage(app).bucket().deleteFiles({ force: true });
    console.log("  storage cleared");
  } catch (e) { console.log("  storage skip:", e.message); }

  if (wipeAuth) {
    console.log("Deleting all Auth users…");
    let pageToken;
    let n = 0;
    do {
      const res = await getAuth(app).listUsers(1000, pageToken);
      if (res.users.length) { await getAuth(app).deleteUsers(res.users.map((u) => u.uid)); n += res.users.length; }
      pageToken = res.pageToken;
    } while (pageToken);
    console.log(`  deleted ${n} users`);
  }

  console.log("Done.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
