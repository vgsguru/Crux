import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";


import { getAdminDb, getAdminAuth } from '@/integrations/firebase/admin';

const QSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(4).max(2000),
  expectedSignal: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  companyId: z.string().nullable().optional(),
});

export const upsertQuestion = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => QSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const payload = {
      owner_id: context.userId,
      company_id: data.companyId ?? null,
      text: data.text,
      expected_signal: data.expectedSignal ?? null,
      tags: data.tags,
      difficulty: data.difficulty,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      await db.collection("question_bank").doc(data.id).update(payload);
      return { id: data.id };
    }
    const ref = await db.collection("question_bank").add({ ...payload, created_at: new Date().toISOString() });
    return { id: ref.id };
  });

export const deleteQuestion = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const snap = await db.collection("question_bank").doc(data.id).get();
    if (!snap.exists || (snap.data() as any).owner_id !== context.userId) throw new Error("Not found");
    await db.collection("question_bank").doc(data.id).delete();
    return { ok: true };
  });
