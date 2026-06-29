import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';

let _app: App | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;

/**
 * Resolve service-account credentials for the Admin SDK.
 *
 * Order of precedence:
 *  1. FIREBASE_SERVICE_ACCOUNT — full service-account JSON (stringified) in an env var.
 *  2. Application Default Credentials — GOOGLE_APPLICATION_CREDENTIALS file path, or the
 *     ambient identity when deployed on Google Cloud / Firebase.
 *
 * verifyIdToken() only needs the project id (it fetches Google's public certs), but
 * Firestore and Storage admin access require real credentials, so we always try to
 * attach them.
 */
async function buildAppOptions() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    (projectId ? `${projectId}.appspot.com` : undefined);

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const { cert } = await import('firebase-admin/app');
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON');
    }
    // Private keys pasted into env files often have escaped newlines.
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return { credential: cert(parsed as any), projectId, storageBucket };
  }

  // Fall back to Application Default Credentials.
  const { applicationDefault } = await import('firebase-admin/app');
  try {
    return { credential: applicationDefault(), projectId, storageBucket };
  } catch {
    // No ADC available — return bare options. Auth token verification still works;
    // Firestore/Storage writes will fail until credentials are provided.
    return { projectId, storageBucket };
  }
}

async function getAdminApp(): Promise<App> {
  if (_app) return _app;
  const { initializeApp, getApps, getApp } = await import('firebase-admin/app');
  if (getApps().length) {
    _app = getApp();
    return _app;
  }
  _app = initializeApp(await buildAppOptions());
  return _app;
}

export async function getAdminDb(): Promise<Firestore> {
  if (!_db) {
    const { getFirestore } = await import('firebase-admin/firestore');
    _db = getFirestore(await getAdminApp());
  }
  return _db;
}

export async function getAdminAuth(): Promise<Auth> {
  if (!_auth) {
    const { getAuth } = await import('firebase-admin/auth');
    _auth = getAuth(await getAdminApp());
  }
  return _auth;
}
