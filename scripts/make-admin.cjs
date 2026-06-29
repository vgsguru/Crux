#!/usr/bin/env node
/**
 * Bootstrap a Crux admin account (the first admin can't be made from the UI).
 *   node scripts/make-admin.cjs                      # creates admin@crux.app
 *   node scripts/make-admin.cjs you@example.com      # promotes an existing email to admin
 * Reads FIREBASE_SERVICE_ACCOUNT from .env.
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

const EMAIL = process.argv[2] || "admin@crux.app";
const PASSWORD = "CruxAdmin@2026";

(async () => {
  const sa = JSON.parse(readEnv("FIREBASE_SERVICE_ACCOUNT"));
  const { initializeApp, cert } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");
  const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
  const db = getFirestore(app);
  const auth = getAuth(app);

  let user;
  let created = false;
  try {
    user = await auth.getUserByEmail(EMAIL);
  } catch {
    user = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true, displayName: "Crux Admin" });
    created = true;
  }

  await db.collection("users").doc(user.uid).set({ role: "admin", full_name: "Crux Admin" }, { merge: true });
  await db.collection("profiles").doc(user.uid).set({ full_name: "Crux Admin", username: "cruxadmin" }, { merge: true });
  await db.collection("usernames").doc("cruxadmin").set({ uid: user.uid, created_at: new Date().toISOString() }, { merge: true });

  console.log("Admin ready:");
  console.log("  email:", EMAIL);
  if (created) console.log("  password:", PASSWORD, "(change it after first login)");
  else console.log("  password: (unchanged — this account already existed; it was just promoted to admin)");
  console.log("  uid:", user.uid);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
