import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { getAdminDb, getAdminAuth } from "@/integrations/firebase/admin";
import { groqChat, extractJson, GROQ_CHAT_MODEL } from "@/lib/ai-providers.server";

async function notify(db: FirebaseFirestore.Firestore, userId: string, n: { kind: string; title: string; body?: string; link?: string }) {
  await db.collection("notifications").add({
    user_id: userId, kind: n.kind, title: n.title, body: n.body ?? null,
    link: n.link ?? null, read_at: null, created_at: new Date().toISOString(),
  });
}

// Notify users @mentioned in a post (resolves handles → uids server-side).
export const notifyMentions = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    handles: z.array(z.string()).max(20),
    postId: z.string(),
    postTitle: z.string().max(200).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const meSnap = await db.collection("profiles").doc(context.userId).get();
    const myName = meSnap.exists ? (meSnap.data() as any).full_name || "Someone" : "Someone";
    const unique = [...new Set(data.handles.map((h) => h.toLowerCase()))].slice(0, 20);
    let notified = 0;
    await Promise.all(unique.map(async (h) => {
      const uSnap = await db.collection("usernames").doc(h).get();
      const uid = uSnap.exists ? (uSnap.data() as any).uid : null;
      if (!uid || uid === context.userId) return;
      await notify(db, uid, {
        kind: "mention",
        title: `${myName} mentioned you in a post`,
        body: data.postTitle ?? "",
        link: `/feed?post=${data.postId}`,
      });
      notified++;
    }));
    return { ok: true, notified };
  });

// Applicant submits an application (resume + optional project). Runs an AI resume↔role
// audit, marks it "applied", and notifies the recruiter. No live interview here —
// the interview is gated behind recruiter approval (inviteToInterview).
export const submitApplication = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    applicationId: z.string(),
    projectPostId: z.string().nullable().optional(),
    projectLink: z.string().max(500).nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appRef = db.collection("applications").doc(data.applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;
    if (app.applicant_id !== context.userId) throw new Error("Forbidden");

    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const job = jobSnap.data() as any;

    // AI audit: resume vs role.
    let match: any = null;
    if (app.resume_text) {
      try {
        const ai = await groqChat(GROQ_CHAT_MODEL, {
          messages: [
            { role: "system", content: `Compare a candidate's resume against the role. Output STRICT JSON: {"matched_skills":[".."],"gaps":[".."],"extras":[".."],"overall_pct":0-100,"summary":"1-2 sentences"}` },
            { role: "user", content: `ROLE: ${job.title}\n\n${job.description}\n\nIDEAL: ${job.ideal_profile ?? ""}\n\nRESUME:\n${String(app.resume_text).slice(0, 6000)}` },
          ],
          response_format: { type: "json_object" },
        });
        match = extractJson<any>(ai.choices[0]?.message?.content ?? "{}");
      } catch { /* audit best-effort */ }
    }

    await appRef.update({
      status: "applied",
      pipeline_status: "applied",
      submitted_at: new Date().toISOString(),
      attached_project_id: data.projectPostId ?? null,
      attached_project_link: data.projectLink ?? null,
      ...(match ? { resume_match: match } : {}),
    });

    // Notify the recruiter (company owner).
    const compSnap = job.company_id ? await db.collection("companies").doc(job.company_id).get() : null;
    const ownerId = compSnap?.exists ? (compSnap.data() as any).owner_id : null;
    if (ownerId) {
      const pSnap = await db.collection("profiles").doc(context.userId).get();
      const name = pSnap.exists ? (pSnap.data() as any).full_name || "A candidate" : "A candidate";
      await notify(db, ownerId, {
        kind: "application",
        title: `New application for ${job.title}`,
        body: `${name} applied${match?.overall_pct != null ? ` · ${Math.round(match.overall_pct)}% resume match` : ""}.`,
        link: `/recruiter/applications/${data.applicationId}`,
      });
    }
    return { ok: true, overall_pct: match?.overall_pct ?? null };
  });

// Recruiter advances a candidate to the interview round and notifies them.
export const inviteToInterview = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appRef = db.collection("applications").doc(data.applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;

    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    const job = jobSnap.exists ? jobSnap.data() as any : null;
    const compSnap = job?.company_id ? await db.collection("companies").doc(job.company_id).get() : null;
    if (!compSnap?.exists || (compSnap.data() as any).owner_id !== context.userId) throw new Error("Forbidden");

    await appRef.update({ status: "interview_invited", pipeline_status: "interview", invited_at: new Date().toISOString() });
    await notify(db, app.applicant_id, {
      kind: "interview_invite",
      title: `You're invited to interview for ${job?.title ?? "a role"}`,
      body: "Open your application to start the AI interview.",
      link: `/me/applications/${data.applicationId}`,
    });
    return { ok: true };
  });
