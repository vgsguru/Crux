import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";


import { getAdminDb, getAdminAuth } from '@/integrations/firebase/admin';

const TemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  rubric: z.record(z.string(), z.number().min(0).max(100)).default({}),
  companyId: z.string().nullable().optional(),
});

export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => TemplateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const payload = {
      owner_id: context.userId,
      name: data.name,
      description: data.description ?? null,
      rubric: data.rubric,
      company_id: data.companyId ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      await db.collection("interview_templates").doc(data.id).update(payload);
      return { id: data.id };
    }
    const ref = await db.collection("interview_templates").add({ ...payload, created_at: new Date().toISOString() });
    return { id: ref.id };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const snap = await db.collection("interview_templates").doc(data.id).get();
    if (!snap.exists || (snap.data() as any).owner_id !== context.userId) throw new Error("Not found");
    await db.collection("interview_templates").doc(data.id).delete();
    return { ok: true };
  });

export const attachQuestionToTemplate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    templateId: z.string(),
    questionId: z.string().optional(),
    textOverride: z.string().max(2000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const tSnap = await db.collection("interview_templates").doc(data.templateId).get();
    if (!tSnap.exists || (tSnap.data() as any).owner_id !== context.userId) throw new Error("Forbidden");

    const lastSnap = await db.collection("interview_template_questions")
      .where("template_id", "==", data.templateId)
      .orderBy("position", "desc")
      .limit(1)
      .get();
    const nextPos = lastSnap.empty ? 0 : ((lastSnap.docs[0].data() as any).position ?? -1) + 1;

    await db.collection("interview_template_questions").add({
      template_id: data.templateId,
      question_id: data.questionId ?? null,
      text_override: data.textOverride ?? null,
      position: nextPos,
    });
    return { ok: true };
  });

export const detachQuestionFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const db = await getAdminDb();
    await db.collection("interview_template_questions").doc(data.id).delete();
    return { ok: true };
  });

export const setJobInterviewTemplate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    jobId: z.string(),
    templateId: z.string().nullable(),
    mode: z.enum(["async", "live"]).default("async"),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const jobSnap = await db.collection("jobs").doc(data.jobId).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const job = jobSnap.data() as any;

    const compSnap = await db.collection("companies").doc(job.company_id).get();
    const comp = compSnap.exists ? compSnap.data() as any : null;
    if (!comp || comp.owner_id !== context.userId) throw new Error("Forbidden");

    await db.collection("jobs").doc(data.jobId).update({
      interview_template_id: data.templateId,
      interview_mode: data.mode,
    });
    return { ok: true };
  });
