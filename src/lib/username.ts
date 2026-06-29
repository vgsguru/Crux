import { db } from "@/integrations/firebase/client";
import { doc, getDoc, setDoc } from "firebase/firestore";

// Reserved top-level paths that can't be usernames (they're real routes).
export const RESERVED_USERNAMES = new Set([
  "", "jobs", "feed", "auth", "recruiter", "me", "apply", "interview",
  "admin", "profile", "api", "u", "settings", "about", "login", "signup",
]);

function slugify(name: string): string {
  return (name || "user")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16) || "user";
}

/**
 * Returns the user's existing username, or generates + reserves a unique one.
 * Usernames live in a `usernames/{username}` doc mapping to the uid, and are also
 * stored on the user's `users` + `profiles` docs. Free-tier friendly (Firestore only).
 */
export async function ensureUsername(uid: string, name: string): Promise<string> {
  // Already have one on the profile?
  const profileSnap = await getDoc(doc(db, "profiles", uid));
  const existing = profileSnap.exists() ? (profileSnap.data() as any).username : null;
  if (existing) return existing;

  const base = slugify(name);
  let username = base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 && !RESERVED_USERNAMES.has(base)
      ? base
      : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const ref = doc(db, "usernames", candidate);
    const snap = await getDoc(ref);
    if (!snap.exists() && !RESERVED_USERNAMES.has(candidate)) {
      await setDoc(ref, { uid, created_at: new Date().toISOString() });
      username = candidate;
      break;
    }
    username = `${base}${uid.slice(0, 6).toLowerCase()}`;
  }

  await setDoc(doc(db, "users", uid), { username }, { merge: true });
  await setDoc(doc(db, "profiles", uid), { username }, { merge: true });
  return username;
}

export async function resolveUsername(username: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "usernames", username.toLowerCase()));
  return snap.exists() ? ((snap.data() as any).uid as string) : null;
}

// Let a user set a custom handle (e.g. crux.app/<handle>). Validates format,
// reserved words and uniqueness. Keeps the old handle pointing at the same uid.
export async function claimUsername(uid: string, desired: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  const u = desired.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (u.length < 3) return { ok: false, error: "At least 3 characters (letters, numbers, underscore)" };
  if (u.length > 24) return { ok: false, error: "Keep it under 24 characters" };
  if (RESERVED_USERNAMES.has(u)) return { ok: false, error: "That handle is reserved" };
  const existing = await getDoc(doc(db, "usernames", u));
  if (existing.exists() && (existing.data() as any).uid !== uid) return { ok: false, error: "That handle is taken" };
  await setDoc(doc(db, "usernames", u), { uid, created_at: new Date().toISOString() }, { merge: true });
  await setDoc(doc(db, "profiles", uid), { username: u }, { merge: true });
  await setDoc(doc(db, "users", uid), { username: u }, { merge: true });
  return { ok: true, username: u };
}
