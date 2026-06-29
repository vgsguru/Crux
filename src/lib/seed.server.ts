import { createServerFn } from "@tanstack/react-start";
import { getAdminDb, getAdminAuth } from '@/integrations/firebase/admin';

export const DEMO_ACCOUNTS = {
  recruiter: { email: "recruiter@demo.Crux", password: "DemoPass!234", full_name: "Demo Recruiter" },
  applicant: { email: "applicant@demo.Crux", password: "DemoPass!234", full_name: "Demo Applicant" },
} as const;

export const seedDemoAccounts = createServerFn({ method: "POST" }).handler(async () => {
  const db = await getAdminDb();
  const auth = await getAdminAuth();

  const results: Record<string, { created: boolean; email: string; user_id: string }> = {};

  for (const [role, info] of Object.entries(DEMO_ACCOUNTS) as Array<
    ["recruiter" | "applicant", (typeof DEMO_ACCOUNTS)[keyof typeof DEMO_ACCOUNTS]]
  >) {
    let user;
    let created = false;
    
    try {
      user = await auth.getUserByEmail(info.email);
      // Reset password so it matches
      await auth.updateUser(user.uid, { password: info.password });
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        user = await auth.createUser({
          email: info.email,
          password: info.password,
          emailVerified: true,
          displayName: info.full_name,
        });
        created = true;
      } else {
        throw err;
      }
    }

    // Canonical role store: users/{uid}.role as a single string (matches use-auth
    // and server-side role checks). Also seed a profiles doc so the account renders
    // in the feed and on profile pages.
    await db.collection('users').doc(user.uid).set({
      role,
      full_name: info.full_name,
    }, { merge: true });
    await db.collection('profiles').doc(user.uid).set({
      full_name: info.full_name,
      avatar_url: null,
    }, { merge: true });

    results[role] = { created, email: info.email, user_id: user.uid };
  }

  return {
    ok: true,
    accounts: [
      { role: "recruiter", email: DEMO_ACCOUNTS.recruiter.email, password: DEMO_ACCOUNTS.recruiter.password },
      { role: "applicant", email: DEMO_ACCOUNTS.applicant.email, password: DEMO_ACCOUNTS.applicant.password },
    ],
    results,
  };
});
