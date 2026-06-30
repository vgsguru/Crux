import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { getAdminDb, getAdminAuth } from "@/integrations/firebase/admin";
import { groqChat, extractJson, GROQ_CHAT_MODEL, sendEmail } from "@/lib/ai-providers.server";

// Loads job + company and verifies the caller owns the company. Returns context.
async function requireJobOwner(db: FirebaseFirestore.Firestore, app: any, callerId: string) {
  const jobSnap = await db.collection("jobs").doc(app.job_id).get();
  const job = jobSnap.exists ? (jobSnap.data() as any) : null;
  const compSnap = job?.company_id ? await db.collection("companies").doc(job.company_id).get() : null;
  if (!compSnap?.exists || (compSnap.data() as any).owner_id !== callerId) throw new Error("Forbidden");
  return { job, company: compSnap.data() as any };
}

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

// Fan out a notification to everyone following a company when it posts a new job.
export const notifyFollowers = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string(), postId: z.string(), title: z.string().max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const comp = await db.collection("companies").doc(data.companyId).get();
    if (!comp.exists || (comp.data() as any).owner_id !== context.userId) throw new Error("Forbidden");
    const name = (comp.data() as any).name ?? "A company";
    const snap = await db.collection("follows").where("company_id", "==", data.companyId).get();
    let notified = 0;
    await Promise.all(snap.docs.map(async (d) => {
      const uid = (d.data() as any).user_id;
      if (!uid || uid === context.userId) return;
      await notify(db, uid, { kind: "company_post", title: `${name} posted a new job`, body: data.title, link: `/feed?tab=jobs` });
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
    answers: z.array(z.object({ q: z.string(), a: z.string() })).max(12).optional(),
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

    // AI audit: resume + phase-1 answers vs the role. Bias-blind (no name/age/gender).
    // Produces a report shown to BOTH the recruiter and the candidate.
    let match: any = null;
    if (app.resume_text || (data.answers && data.answers.length)) {
      try {
        const answersBlock = (data.answers ?? []).map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`).join("\n\n");
        const ai = await groqChat(GROQ_CHAT_MODEL, {
          messages: [
            { role: "system", content: `You are a fair, encouraging hiring analyst. Compare a candidate's resume and screening answers against the role. Ignore name, gender, age, and personal identifiers. Output STRICT JSON: {"matched_skills":[".."],"gaps":[".."],"extras":[".."],"skills_to_learn":[".."],"projects_to_build":[".."],"answer_feedback":"1-2 sentences on the screening answers","overall_pct":0-100,"summary":"2-3 sentence verdict written to the candidate"}` },
            { role: "user", content: `ROLE: ${job.title}\n\n${job.description}\n\nIDEAL: ${job.ideal_profile ?? ""}\n\nRESUME:\n${String(app.resume_text ?? "").slice(0, 6000)}\n\nSCREENING ANSWERS:\n${answersBlock || "(none)"}` },
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
      screening_answers: data.answers ?? [],
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
    return { ok: true, overall_pct: match?.overall_pct ?? null, report: match };
  });

// Save the candidate's compulsory 20–30s intro video URL on their application.
export const saveIntroVideo = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string(), url: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appRef = db.collection("applications").doc(data.applicationId);
    const snap = await appRef.get();
    if (!snap.exists) throw new Error("Application not found");
    if ((snap.data() as any).applicant_id !== context.userId) throw new Error("Forbidden");
    await appRef.update({ intro_video_url: data.url });
    return { ok: true };
  });

// Recruiter advances a candidate to the interview round and notifies them.
export const inviteToInterview = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string(), deadlineDays: z.number().min(1).max(30).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appRef = db.collection("applications").doc(data.applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;
    const { job, company } = await requireJobOwner(db, app, context.userId);

    const days = data.deadlineDays ?? 7;
    const deadline = new Date(Date.now() + days * 86400_000);
    const deadlineStr = deadline.toISOString().slice(0, 10);

    await appRef.update({ status: "interview_invited", pipeline_status: "interview", invited_at: new Date().toISOString(), interview_deadline: deadline.toISOString() });
    await notify(db, app.applicant_id, {
      kind: "interview_invite",
      title: `You're invited to interview for ${job?.title ?? "a role"}`,
      body: `Complete your AI interview by ${deadlineStr}.`,
      link: `/me/applications/${data.applicationId}`,
    });
    // Email the candidate with the deadline.
    try {
      const auth = await getAdminAuth();
      const email = (await auth.getUser(app.applicant_id)).email;
      if (email) {
        await sendEmail({
          to: email,
          subject: `Interview invitation — ${job?.title ?? "your application"} at ${company?.name ?? "Crux"}`,
          html: `<p>Good news — you've been shortlisted for the interview round for <b>${job?.title ?? "the role"}</b>${company?.name ? ` at <b>${company.name}</b>` : ""}.</p>
                 <p>Please complete your AI interview (including a short 20–30s intro video) by <b>${deadlineStr}</b>.</p>
                 <p>Open your application to begin.</p>`,
        });
      }
    } catch { /* email best-effort */ }
    return { ok: true, deadline: deadline.toISOString() };
  });

// Recruiter's final decision: send offer, schedule a meeting, or reject. Emails + notifies the candidate.
export const decideCandidate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    applicationId: z.string(),
    action: z.enum(["offer", "schedule", "reject"]),
    details: z.string().max(2000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appRef = db.collection("applications").doc(data.applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;
    const { job, company } = await requireJobOwner(db, app, context.userId);
    const role = job?.title ?? "the role";
    const co = company?.name ?? "the company";
    const details = (data.details ?? "").trim();

    const MAP = {
      offer: {
        status: "offer_sent", pipeline: "hired",
        title: `🎉 Offer for ${role}`,
        body: `${co} has sent you an offer.`,
        subject: `Job offer — ${role} at ${co}`,
        html: `<p>Congratulations! <b>${co}</b> would like to offer you the <b>${role}</b> position.</p>${details ? `<p>${details.replace(/\n/g, "<br>")}</p>` : ""}<p>We'll be in touch with next steps.</p>`,
      },
      schedule: {
        status: "meeting_scheduled", pipeline: "interview",
        title: `Meeting invite — ${role}`,
        body: `${co} wants to schedule a meeting.`,
        subject: `Let's talk — ${role} at ${co}`,
        html: `<p><b>${co}</b> would like to schedule a meeting with you about the <b>${role}</b> role.</p>${details ? `<p><b>Details:</b><br>${details.replace(/\n/g, "<br>")}</p>` : "<p>They'll share details shortly.</p>"}`,
      },
      reject: {
        status: "rejected", pipeline: "rejected",
        title: `Update on your ${role} application`,
        body: `An update on your application to ${co}.`,
        subject: `Update on your application — ${role} at ${co}`,
        html: `<p>Thank you for your interest in the <b>${role}</b> role at <b>${co}</b>. After careful review, we won't be moving forward at this time.</p>${details ? `<p>${details.replace(/\n/g, "<br>")}</p>` : ""}<p>We genuinely appreciate the time you invested and wish you the best.</p>`,
      },
    } as const;
    const m = MAP[data.action];

    await appRef.update({ status: m.status, pipeline_status: m.pipeline, decided_at: new Date().toISOString(), decision_note: details || null });
    await notify(db, app.applicant_id, { kind: "decision", title: m.title, body: m.body, link: `/me/applications/${data.applicationId}` });
    try {
      const auth = await getAdminAuth();
      const email = (await auth.getUser(app.applicant_id)).email;
      if (email) await sendEmail({ to: email, subject: m.subject, html: m.html });
    } catch { /* email best-effort */ }
    return { ok: true, status: m.status };
  });
