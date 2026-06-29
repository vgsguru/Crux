import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { getAdminDb, getAdminAuth } from "@/integrations/firebase/admin";

async function assertAdmin(uid: string) {
  const db = await getAdminDb();
  const snap = await db.collection("users").doc(uid).get();
  const role = snap.exists ? (snap.data() as any).role : null;
  if (role !== "admin" && !(Array.isArray(role) && role.includes("admin"))) {
    throw new Error("Admins only");
  }
  return db;
}

// Dashboard overview counts.
export const adminStats = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .handler(async ({ context }) => {
    const db = await assertAdmin(context.userId);
    const names = ["users", "companies", "jobs", "applications", "credentials"] as const;
    const counts: Record<string, number> = {};
    await Promise.all(names.map(async (n) => { counts[n] = (await db.collection(n).count().get()).data().count; }));
    const openReports = (await db.collection("reports").where("status", "==", "open").count().get()).data().count;
    const pendingVer = (await db.collection("company_verifications").where("status", "==", "pending").count().get()).data().count;
    const verifiedCompanies = (await db.collection("companies").where("verification_status", "==", "verified").count().get()).data().count;
    return { ...counts, openReports, pendingVer, verifiedCompanies };
  });

// Users list (Firestore role + auth email), most-recent first.
export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .handler(async ({ context }) => {
    const db = await assertAdmin(context.userId);
    const [usersSnap, profSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("profiles").get(),
    ]);
    const profByUid = new Map(profSnap.docs.map((d) => [d.id, d.data() as any]));
    const auth = await getAdminAuth();
    const rows = await Promise.all(usersSnap.docs.map(async (d) => {
      const u = d.data() as any;
      let email: string | null = null;
      try { email = (await auth.getUser(d.id)).email ?? null; } catch { /* deleted */ }
      const p = profByUid.get(d.id) || {};
      return {
        uid: d.id, full_name: u.full_name || p.full_name || null, email,
        role: Array.isArray(u.role) ? u.role[0] : (u.role || null),
        username: p.username || null, created_at: u.created_at || null,
      };
    }));
    return rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, 300);
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((i: unknown) => z.object({ uid: z.string(), role: z.enum(["admin", "recruiter", "applicant"]) }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await assertAdmin(context.userId);
    await db.collection("users").doc(data.uid).set({ role: data.role }, { merge: true });
    return { ok: true };
  });

export const adminListReports = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .handler(async ({ context }) => {
    const db = await assertAdmin(context.userId);
    const snap = await db.collection("reports").get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, 200);
  });

export const adminResolveReport = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string(), action: z.enum(["resolved", "dismissed"]) }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await assertAdmin(context.userId);
    await db.collection("reports").doc(data.id).set({ status: data.action, resolved_at: new Date().toISOString(), resolved_by: context.userId }, { merge: true });
    return { ok: true };
  });

export const adminListVerifications = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .handler(async ({ context }) => {
    const db = await assertAdmin(context.userId);
    const snap = await db.collection("company_verifications").get();
    const rows = await Promise.all(snap.docs.map(async (d) => {
      const v = { id: d.id, ...(d.data() as any) };
      if (v.company_id) {
        const c = await db.collection("companies").doc(v.company_id).get();
        v.company = c.exists ? { name: (c.data() as any).name, website: (c.data() as any).website ?? null } : null;
      }
      return v;
    }));
    return rows.sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1));
  });
