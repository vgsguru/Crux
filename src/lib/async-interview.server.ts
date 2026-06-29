import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { getAdminDb } from '@/integrations/firebase/admin';
import { groqChat, groqTranscribe, extractJson, redactPII, GROQ_CHAT_MODEL } from '@/lib/ai-providers.server';

// ----- Start an async interview: returns questions list and interview row -----
export const startAsyncInterview = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((input: unknown) => z.object({ applicationId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appRef = db.collection("applications").doc(data.applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data()!;
    if (app.applicant_id !== context.userId) throw new Error("Forbidden");
    
    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    const job = jobSnap.data()!;

    // resolve question list
    let questions: string[] = [];
    if (job.interview_template_id) {
      const templateQSnap = await db.collection("interview_template_questions")
        .where("template_id", "==", job.interview_template_id)
        .orderBy("position", "asc")
        .get();
      
      const qPromises = templateQSnap.docs.map(async (docSnap: any) => {
        const row = docSnap.data();
        if (row.text_override) return row.text_override;
        // templates.server stores the linked bank question as `question_id`.
        if (row.question_id) {
          const qSnap = await db.collection("question_bank").doc(row.question_id).get();
          if (qSnap.exists) return qSnap.data()!.text;
        }
        return "";
      });
      const resolved = await Promise.all(qPromises);
      questions = resolved.filter(Boolean);
    }
    
    if (questions.length === 0 && job.questions) {
      questions = job.questions.filter((q: string) => q && q.trim().length > 0);
    }
    if (questions.length === 0) {
      questions = [
        `Tell us why you're interested in the ${job.title} role.`,
        `Walk us through a project that best demonstrates the skills required.`,
        `What's the hardest problem you've solved recently?`,
      ];
    }

    const existingSnap = await db.collection("interviews")
      .where("application_id", "==", data.applicationId)
      .limit(1).get();
      
    let interviewId: string;
    if (!existingSnap.empty) {
      interviewId = existingSnap.docs[0].id;
      await db.collection("interviews").doc(interviewId).update({
        mode: "async",
        started_at: new Date().toISOString(),
        answers: questions.map((q) => ({ q, video_url: null, transcript: null })),
      });
    } else {
      const ivRef = db.collection("interviews").doc();
      interviewId = ivRef.id;
      await ivRef.set({
        id: interviewId,
        application_id: data.applicationId,
        started_at: new Date().toISOString(),
        mode: "async",
        answers: questions.map((q) => ({ q, video_url: null, transcript: null })),
      });
    }
    await appRef.update({
      interview_mode: "async",
      status: "interview_in_progress",
    });
    return { interviewId, questions };
  });

// ----- Save a single answer -----
export const saveAsyncAnswer = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((input: unknown) => z.object({
    interviewId: z.string(),
    index: z.number().int().min(0).max(50),
    videoPath: z.string().min(1),
    transcript: z.string().max(8000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const ivRef = db.collection("interviews").doc(data.interviewId);
    const ivSnap = await ivRef.get();
    if (!ivSnap.exists) throw new Error("Interview not found");
    const iv = ivSnap.data()!;
    
    const appSnap = await db.collection("applications").doc(iv.application_id).get();
    const app = appSnap.data()!;
    
    if (app.applicant_id !== context.userId) throw new Error("Forbidden");

    const answers = Array.isArray(iv.answers) ? [...iv.answers] : [];
    if (data.index >= answers.length) throw new Error("Index out of range");
    answers[data.index] = {
      ...answers[data.index],
      video_url: data.videoPath,
      transcript: data.transcript ?? answers[data.index]?.transcript ?? null,
    };
    await ivRef.update({ answers });
    return { ok: true };
  });

// ----- Finalize async interview -----
export const finalizeAsyncInterview = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((input: unknown) => z.object({ interviewId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const ivRef = db.collection("interviews").doc(data.interviewId);
    const ivSnap = await ivRef.get();
    if (!ivSnap.exists) throw new Error("Interview not found");
    const iv = ivSnap.data()!;
    
    const appSnap = await db.collection("applications").doc(iv.application_id).get();
    const app = appSnap.data()!;
    if (app.applicant_id !== context.userId) throw new Error("Forbidden");

    const answers = Array.isArray(iv.answers) ? iv.answers : [];
    if (answers.length === 0) throw new Error("No answers");
    const transcript = answers.map((a: any) => ({ q: a.q, a: a.transcript ?? "(no transcript provided)" }));

    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    const job = jobSnap.data()!;

    const grading = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: `You are an expert, impartial interviewer reviewing an async video interview. Score each rubric criterion 0-100 with verbatim evidence citations. Output STRICT JSON: { "scores": { "<criterion>": number }, "evidence": { "<criterion>": { "justification": string, "citations": [ { "source": "resume" | "intro" | "interview", "quote": string } ] } }, "total": number, "summary": string, "strengths": string[], "concerns": string[], "recommendation": "Strong hire" | "Hire" | "Maybe" | "No hire" }` },
        { role: "user", content: `Job: ${job.title}\n${job.description}\nIdeal: ${job.ideal_profile ?? ""}\nRubric weights: ${JSON.stringify(job.rubric)}\n\nResume:\n${redactPII(app.resume_text)}\n\nIntro:\n${redactPII(app.intro_transcript)}\n\nInterview answers:\n${transcript.map((t) => "Q: " + t.q + "\\nA: " + t.a).join("\\n\\n")}` },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = extractJson<{ scores: Record<string, number>; evidence?: Record<string, { justification: string; citations: Array<{ source: string; quote: string }> }>; total: number; summary: string; strengths: string[]; concerns: string[]; recommendation: string }>(grading.choices[0].message.content);

    await ivRef.update({
      transcript,
      ended_at: new Date().toISOString(),
    });

    await db.collection("applications").doc(iv.application_id).update({
      status: "scored",
      score: parsed.total,
      score_breakdown: parsed.scores,
      score_evidence: parsed.evidence ?? {},
      ai_summary: parsed.summary,
      ai_highlights: { strengths: parsed.strengths ?? [], concerns: parsed.concerns ?? [], recommendation: parsed.recommendation ?? "" },
      pipeline_status: "interviewed",
    });

    // Portable, candidate-owned proof-of-skill credential.
    const compSnap = job.company_id ? await db.collection("companies").doc(job.company_id).get() : null;
    await db.collection("credentials").doc(iv.application_id).set({
      user_id: app.applicant_id,
      application_id: iv.application_id,
      job_id: app.job_id,
      job_title: job.title,
      company_name: compSnap?.exists ? (compSnap.data() as any).name ?? null : null,
      score: parsed.total,
      recommendation: parsed.recommendation ?? "",
      mode: "async",
      verified: true,
      created_at: new Date().toISOString(),
    }, { merge: true });

    return { ok: true, total: parsed.total };
  });

// Transcribe an answer audio/video without persisting to applications
export const transcribeAnswer = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((input: unknown) => z.object({
    interviewId: z.string(),
    audioBase64: z.string(),
    mime: z.string(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    
    const ivSnap = await db.collection("interviews").doc(data.interviewId).get();
    if (!ivSnap.exists) throw new Error("Interview not found");
    const iv = ivSnap.data()!;
    const appSnap = await db.collection("applications").doc(iv.application_id).get();
    if (appSnap.data()!.applicant_id !== context.userId) throw new Error("Forbidden");
    
    const transcript = await groqTranscribe(data.audioBase64, data.mime);
    return { transcript: transcript.trim() };
  });
