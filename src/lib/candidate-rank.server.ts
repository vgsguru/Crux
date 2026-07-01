import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { groqChat, extractJson, GROQ_CHAT_MODEL } from "@/lib/ai-providers.server";

const CANDIDATE = z.object({}).passthrough();

// Stage 3 of the hybrid pipeline: an LLM re-ranks the shortlist. It reads the role's
// real intent (required + transferable skills, seniority, domain) and weighs behavioral
// signals — not keyword overlap — then scores each candidate 0-100 with a specific reason.
export const deepRankCandidates = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((i: unknown) => z.object({
    role: z.string(),
    skills: z.array(z.string()).default([]),
    minYoe: z.number().optional(),
    keywords: z.string().optional(),
    candidates: z.array(CANDIDATE).max(200),
  }).parse(i))
  .handler(async ({ data }) => {
    const reqBlock = `ROLE: ${data.role || "(infer from context)"}
Must-have skills: ${data.skills.join(", ") || "(infer from the role)"}
Minimum experience: ${data.minYoe ?? 0} years
Extra context: ${data.keywords ?? "none"}`;

    const BATCH = 20;
    const batches: any[][] = [];
    for (let i = 0; i < data.candidates.length; i += BATCH) batches.push(data.candidates.slice(i, i + BATCH));

    const system = `You are an elite technical recruiter ranking candidates for a specific role.
Reason about what the role GENUINELY needs — the required skills, closely transferable skills, the right seniority, and domain relevance — do NOT reward shallow keyword overlap. Then factor in real hiring signals: responsiveness (response_rate), interview_completion, offer_acceptance, profile_completeness, github activity, skill assessment scores, and open-to-work.
Score each candidate 0-100 for GENUINE fit for THIS role (be discriminating — spread the scores; a weak match should score low).
Output STRICT JSON only: {"scores":[{"id":"CAND_XXXXXXX","score":<integer 0-100>,"reason":"one concrete sentence citing specific evidence (skills, years, a signal)"}]}. Include EVERY candidate id you were given.`;

    const results = await Promise.all(
      batches.map(async (batch) => {
        try {
          const ai = await groqChat(GROQ_CHAT_MODEL, {
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: `${reqBlock}\n\nCANDIDATES (JSON array):\n${JSON.stringify(batch)}` },
            ],
          });
          const parsed = extractJson<{ scores: Array<{ id: string; score: number; reason: string }> }>(ai.choices[0]?.message?.content ?? "{}");
          return Array.isArray(parsed.scores) ? parsed.scores : [];
        } catch {
          // Degrade gracefully: neutral score so these keep their stage-1 order.
          return batch.map((c: any) => ({ id: c.id, score: 50, reason: "Ranked on structured signals (AI re-rank unavailable for this batch)." }));
        }
      }),
    );
    return { scores: results.flat() };
  });
