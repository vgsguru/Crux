import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";

import { getAdminDb } from '@/integrations/firebase/admin';
import { groqChat, extractJson, GROQ_CHAT_MODEL } from '@/lib/ai-providers.server';

export type ResumeMatch = {
  matched_skills: string[];
  gaps: string[];
  extras: string[];
  overall_pct: number;
  summary: string;
};

export const computeResumeMatch = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appSnap = await db.collection("applications").doc(data.applicationId).get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;

    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const job = jobSnap.data() as any;

    const compSnap = await db.collection("companies").doc(job.company_id).get();
    const comp = compSnap.exists ? compSnap.data() as any : null;

    const ownerId = comp?.owner_id;
    if (app.applicant_id !== context.userId && ownerId !== context.userId) throw new Error("Forbidden");
    if (!app.resume_text) throw new Error("No parsed resume yet");

    const grading = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: `You compare a candidate's parsed resume against the role's expectations. Output STRICT JSON:\n{\n  "matched_skills": ["short phrase referenced in BOTH"],\n  "gaps": ["expectation NOT clearly supported by resume"],\n  "extras": ["resume strength not asked for but valuable"],\n  "overall_pct": 0-100,\n  "summary": "1-2 sentence neutral overview"\n}` },
        { role: "user", content: `ROLE: ${job.title}\n\nDESCRIPTION:\n${job.description}\n\nIDEAL CANDIDATE:\n${job.ideal_profile ?? "(none provided)"}\n\nPARSED RESUME:\n${app.resume_text.slice(0, 6000)}` },
      ],
      response_format: { type: "json_object" },
    });
    const match = extractJson<ResumeMatch>(grading.choices[0].message.content);
    await db.collection("applications").doc(data.applicationId).update({ resume_match: match });
    return match;
  });

export const getApplicationPercentile = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const db = await getAdminDb();
    // Firestore doesn't have native percentile RPCs; compute manually
    const appSnap = await db.collection("applications").doc(data.applicationId).get();
    if (!appSnap.exists) return { percentile: null };
    const app = appSnap.data() as any;
    if (!app.score || !app.job_id) return { percentile: null };

    const allSnap = await db.collection("applications")
      .where("job_id", "==", app.job_id)
      .where("score", "!=", null)
      .get();
    const scores = allSnap.docs.map(d => (d.data() as any).score as number).filter((s: number) => typeof s === "number");
    if (scores.length === 0) return { percentile: null };
    const below = scores.filter((s: number) => s < app.score).length;
    const percentile = Math.round((below / scores.length) * 100);
    return { percentile };
  });
