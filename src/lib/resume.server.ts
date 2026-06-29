import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";


import { getAdminDb } from '@/integrations/firebase/admin';
import { groqChat, extractJson, GROQ_CHAT_MODEL } from '@/lib/ai-providers.server';

export const parseProfileResume = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ resumeText: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const system = `You are an expert resume parser. Extract the applicant's profile data from the resume text.
Output STRICT JSON ONLY (no prose, no markdown fences) matching this shape:
{
  "headline": "Short professional headline (e.g. Senior Software Engineer)",
  "bio": "A 2-3 sentence professional summary",
  "skills": ["React", "TypeScript", "Node.js"],
  "experiences": [
    { "role": "string", "company": "string", "duration": "string", "description": "string" }
  ],
  "education": [
    { "degree": "string", "institution": "string", "year": "string" }
  ],
  "links": [
    { "title": "GitHub", "url": "https://github.com/..." },
    { "title": "LinkedIn", "url": "https://linkedin.com/in/..." }
  ]
}
If a field is missing, return an empty string or array.`;
    const ai = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: data.resumeText.slice(0, 12000) },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = extractJson<any>(ai.choices[0]?.message?.content ?? "{}");
    
    // Save to Firestore
    await db.collection("profiles").doc(context.userId).set({
      headline: parsed.headline || null,
      bio: parsed.bio || null,
      skills: parsed.skills || [],
      experiences: parsed.experiences || [],
      education: parsed.education || [],
      links: parsed.links || [],
      onboarding_completed: true,
    }, { merge: true });

    return { ok: true, data: parsed };
  });

export const completeRecruiterOnboarding = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    companyName: z.string(),
    description: z.string().optional(),
    websiteUrl: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    // Check if company exists
    const compsSnap = await db.collection("companies").where("owner_id", "==", context.userId).get();
    if (compsSnap.empty) {
      await db.collection("companies").add({
        name: data.companyName,
        description: data.description || null,
        website_url: data.websiteUrl || null,
        owner_id: context.userId,
        verification_status: "pending"
      });
    } else {
      await compsSnap.docs[0].ref.update({
        name: data.companyName,
        description: data.description || null,
        website_url: data.websiteUrl || null,
      });
    }

    await db.collection("profiles").doc(context.userId).set({
      onboarding_completed: true,
    }, { merge: true });

    return { ok: true };
  });
