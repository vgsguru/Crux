import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";


import { getAdminDb } from '@/integrations/firebase/admin';
import { embed } from '@/lib/ai-providers.server';

// ----- Embed a job (recruiter owns it) -----
export const embedJob = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const jobSnap = await db.collection("jobs").doc(data.jobId).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const job = jobSnap.data() as any;

    const compSnap = await db.collection("companies").doc(job.company_id).get();
    const comp = compSnap.exists ? compSnap.data() as any : null;
    if (!comp || comp.owner_id !== context.userId) throw new Error("Forbidden");

    const text = [job.title, job.description, job.ideal_profile, job.location, job.employment_type]
      .filter(Boolean).join("\n\n");
    const vec = await embed(text);
    await db.collection("jobs").doc(data.jobId).update({
      embedding: vec,
      embedding_text: text,
      embedding_updated_at: new Date().toISOString(),
    });
    return { ok: true };
  });

// ----- Embed an applicant profile (self) -----
export const embedMyProfile = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ resumeText: z.string().min(1).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    let resumeText = data.resumeText;
    if (!resumeText) {
      // fall back to the most recent application's parsed resume_text
      const appsSnap = await db.collection("applications")
        .where("applicant_id", "==", context.userId)
        .orderBy("created_at", "desc")
        .limit(1)
        .get();
      if (!appsSnap.empty) {
        resumeText = (appsSnap.docs[0].data() as any).resume_text ?? "";
      }
    }
    if (!resumeText) return { ok: false, reason: "no_resume" };
    const vec = await embed(resumeText);
    await db.collection("profiles").doc(context.userId).set({
      resume_text: resumeText,
      embedding: vec,
      embedding_updated_at: new Date().toISOString(),
    }, { merge: true });
    return { ok: true };
  });

// ----- Request company verification -----
export const requestCompanyVerification = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    companyId: z.string(),
    domain: z.string().max(200).optional(),
    evidenceUrl: z.string().url().max(500).optional(),
    notes: z.string().max(1000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const existingSnap = await db.collection("company_verifications")
      .where("company_id", "==", data.companyId)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!existingSnap.empty) throw new Error("A verification request is already pending");

    await db.collection("company_verifications").add({
      company_id: data.companyId,
      requested_by: context.userId,
      domain: data.domain ?? null,
      evidence_url: data.evidenceUrl ?? null,
      notes: data.notes ?? null,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    const compSnap = await db.collection("companies").doc(data.companyId).get();
    const comp = compSnap.data() as any;
    if (comp?.owner_id === context.userId) {
      await db.collection("companies").doc(data.companyId).update({ verification_status: "pending" });
    }
    return { ok: true };
  });

// ----- Admin decides a verification -----
export const decideCompanyVerification = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    verificationId: z.string(),
    approve: z.boolean(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    // Check admin role
    const userDoc = await db.collection("users").doc(context.userId).get();
    const userRole = userDoc.exists ? (userDoc.data() as any).role : null;
    if (userRole !== "admin") throw new Error("Forbidden");

    const status = data.approve ? "verified" : "rejected";
    const verSnap = await db.collection("company_verifications").doc(data.verificationId).get();
    if (!verSnap.exists) throw new Error("Verification not found");
    const ver = verSnap.data() as any;

    await db.collection("company_verifications").doc(data.verificationId).update({
      status, decided_by: context.userId, decided_at: new Date().toISOString(),
    });
    await db.collection("companies").doc(ver.company_id).update({
      verification_status: status,
      verified_at: data.approve ? new Date().toISOString() : null,
    });
    return { ok: true, status };
  });

// ----- Semantic matchmaking (cosine similarity over embeddings) -----
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Recommend active jobs for the signed-in applicant, ranked by resume↔job similarity.
export const recommendJobsForMe = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ limit: z.number().int().min(1).max(50).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const profileSnap = await db.collection("profiles").doc(context.userId).get();
    const myVec = profileSnap.exists ? (profileSnap.data() as any).embedding as number[] | undefined : undefined;
    if (!myVec?.length) return { ready: false as const, matches: [] as Array<{ id: string; title: string; company_id: string; similarity: number; is_saved: boolean }> };

    const jobsSnap = await db.collection("jobs").where("status", "==", "active").get();

    // Which of these jobs has the user already saved?
    const savedSnap = await db.collection("saved_jobs").where("user_id", "==", context.userId).get();
    const savedIds = new Set(savedSnap.docs.map((d) => (d.data() as any).job_id));

    const scored = jobsSnap.docs
      .map((d) => {
        const j = d.data() as any;
        if (!Array.isArray(j.embedding)) return null;
        return {
          id: d.id,
          title: j.title as string,
          company_id: j.company_id as string,
          similarity: cosineSimilarity(myVec, j.embedding),
          is_saved: savedIds.has(d.id),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, data.limit ?? 12);

    return { ready: true as const, matches: scored };
  });

// Recommend top applicants for a job (recruiter-owned), ranked by resume↔job similarity.
export const recommendCandidatesForJob = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string(), limit: z.number().int().min(1).max(50).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const jobSnap = await db.collection("jobs").doc(data.jobId).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const job = jobSnap.data() as any;

    const compSnap = await db.collection("companies").doc(job.company_id).get();
    if (!compSnap.exists || (compSnap.data() as any).owner_id !== context.userId) throw new Error("Forbidden");

    const jobVec = job.embedding as number[] | undefined;
    if (!jobVec?.length) return { ready: false as const, candidates: [] as Array<{ applicant_id: string; full_name: string | null; similarity: number }> };

    // Rank applicants who applied to this job by profile↔job similarity.
    const appsSnap = await db.collection("applications").where("job_id", "==", data.jobId).get();
    const candidates = await Promise.all(appsSnap.docs.map(async (d) => {
      const a = d.data() as any;
      const pSnap = await db.collection("profiles").doc(a.applicant_id).get();
      const p = pSnap.exists ? pSnap.data() as any : null;
      if (!p?.embedding) return null;
      return {
        applicant_id: a.applicant_id as string,
        full_name: p.full_name ?? null,
        similarity: cosineSimilarity(jobVec, p.embedding),
      };
    }));

    const ranked = candidates
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, data.limit ?? 20);

    return { ready: true as const, candidates: ranked };
  });

// ----- Bulk update application pipeline stage -----
export const bulkUpdateApplicationStage = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    applicationIds: z.array(z.string()).min(1).max(200),
    stage: z.enum(["applied", "interviewed", "shortlisted", "offer", "rejected"]),
  }).parse(input))
  .handler(async ({ data }) => {
    const db = await getAdminDb();
    const batch = db.batch();
    for (const id of data.applicationIds) {
      batch.update(db.collection("applications").doc(id), { pipeline_status: data.stage });
    }
    await batch.commit();
    return { ok: true, affected: data.applicationIds.length };
  });
