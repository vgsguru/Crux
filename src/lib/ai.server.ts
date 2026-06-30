import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { getAdminDb, getAdminAuth } from '@/integrations/firebase/admin';
import sharp from "sharp";
import { getStorage } from "firebase-admin/storage";
import { groqChat, geminiChat, chatterboxTts, extractJson, redactPII, sendEmail, GROQ_CHAT_MODEL } from '@/lib/ai-providers.server';

export const parseResume = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string(), resumeText: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const db = await getAdminDb();
    const ai = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: "Clean and normalize this resume into plain text. Keep: name, contact, summary, work history (role, company, dates, bullets), education, skills. Output PLAIN TEXT only, no markdown." },
        { role: "user", content: data.resumeText.slice(0, 12000) },
      ],
    });
    const resumeText = ai.choices[0]?.message?.content ?? data.resumeText.slice(0, 12000);
    await db.collection("applications").doc(data.applicationId).update({ resume_text: resumeText });
    return { resumeText };
  });

export const transcribeIntro = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string(), audioBase64: z.string(), mime: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const db = await getAdminDb();
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("Missing GROQ_API_KEY");

    const buffer = Buffer.from(data.audioBase64, 'base64');
    const blob = new Blob([buffer], { type: data.mime });
    
    const formData = new FormData();
    const ext = data.mime.includes("mp4") ? "m4a" : "webm";
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", "whisper-large-v3");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}` },
      body: formData as any,
    });
    
    if (!res.ok) throw new Error(`Groq Whisper error ${res.status}: ${await res.text()}`);
    const result = await res.json();
    const transcript = result.text ?? "";

    await db.collection("applications").doc(data.applicationId).update({ intro_transcript: transcript, status: "video_uploaded" });
    return { transcript };
  });

export const startInterview = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const db = await getAdminDb();
    const appSnap = await db.collection("applications").doc(data.applicationId).get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;
    
    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const job = jobSnap.data() as any;
    
    const recruiterQs: string[] = Array.isArray(job?.questions) ? job.questions.filter(Boolean) : [];

    const ai = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: "You generate 3 short interview questions personalized to a candidate's resume and intro pitch for the given job. Output JSON: {\"questions\": string[]}. No extra prose. IMPORTANT: do not reference the candidate's name, gender, age, or personal identifiers — keep questions focused on skills, experience, and motivation only." },
        { role: "user", content: `Job: ${job?.title}\nDescription: ${job?.description}\nIdeal: ${job?.ideal_profile ?? ""}\n\nResume:\n${app.resume_text ?? ""}\n\nIntro pitch:\n${app.intro_transcript ?? ""}` },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = extractJson<{ questions: string[] }>(ai.choices[0].message.content);
    const allQs = [...recruiterQs, ...parsed.questions].slice(0, 8);

    const interviewsSnap = await db.collection("interviews").where("application_id", "==", data.applicationId).limit(1).get();
    let interviewId: string;
    if (!interviewsSnap.empty) {
      interviewId = interviewsSnap.docs[0].id;
      await db.collection("interviews").doc(interviewId).update({ started_at: new Date().toISOString() });
    } else {
      const ref = await db.collection("interviews").add({
        application_id: data.applicationId,
        started_at: new Date().toISOString(),
      });
      interviewId = ref.id;
    }

    await db.collection("applications").doc(data.applicationId).update({ status: "interview_in_progress" });
    return { interviewId, questions: allQs };
  });

export const finishInterview = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    interviewId: z.string(),
    transcript: z.array(z.object({ q: z.string(), a: z.string() })),
    snapshots: z.array(z.string()).optional(),
    flags: z.array(z.string()).optional(),
    videoUrl: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const interviewSnap = await db.collection("interviews").doc(data.interviewId).get();
    if (!interviewSnap.exists) throw new Error("Interview not found");
    const interview = interviewSnap.data() as any;

    await db.collection("interviews").doc(data.interviewId).update({
      transcript: data.transcript, snapshots: data.snapshots ?? [], flags: data.flags ?? [],
      video_url: data.videoUrl, ended_at: new Date().toISOString(),
    });

    const appSnap = await db.collection("applications").doc(interview.application_id).get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;

    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const jobData = jobSnap.data() as any;
    
    const companySnap = await db.collection("companies").doc(jobData.company_id).get();
    const company = companySnap.exists ? companySnap.data() : null;
    const job = { ...jobData, companies: company };

    const grading = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: `You are an expert, impartial interviewer. Score the candidate against each rubric criterion (0-100) and compute a weighted total (0-100). Be fair and evidence-based; never infer demographic info. For EVERY criterion, cite 1-3 short verbatim quotes from the resume, intro pitch, or interview transcript that justify the score. Output STRICT JSON only:\n{\n  "scores": { "<criterion>": number },\n  "evidence": { "<criterion>": { "justification": "1-2 sentence rationale", "citations": [ { "source": "resume" | "intro" | "interview", "quote": "verbatim snippet, <= 200 chars" } ] } },\n  "total": number,\n  "summary": "2-3 sentence neutral overview",\n  "strengths": ["bullet", "bullet", "bullet"],\n  "concerns": ["bullet", "bullet"],\n  "recommendation": "Strong hire | Hire | Maybe | No hire"\n}` },
        { role: "user", content: `Job: ${job.title}\n${job.description}\nIdeal: ${job.ideal_profile ?? ""}\nRubric weights: ${JSON.stringify(job.rubric)}\n\nResume:\n${redactPII(app.resume_text)}\n\nIntro:\n${redactPII(app.intro_transcript)}\n\nInterview transcript:\n${data.transcript.map((t) => `Q: ${t.q}\nA: ${t.a}`).join("\n\n")}` },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = extractJson<any>(grading.choices[0].message.content);

    await db.collection("applications").doc(interview.application_id).update({
      status: "scored",
      score: parsed.total,
      score_breakdown: parsed.scores,
      score_evidence: parsed.evidence ?? {},
      ai_summary: parsed.summary,
      ai_highlights: { strengths: parsed.strengths ?? [], concerns: parsed.concerns ?? [], recommendation: parsed.recommendation ?? "" },
      pipeline_status: "interviewed",
    });

    // Portable, candidate-owned credential — a verified proof-of-skill the
    // candidate can show on their profile and reuse across applications.
    await db.collection("credentials").doc(interview.application_id).set({
      user_id: app.applicant_id,
      application_id: interview.application_id,
      job_id: app.job_id,
      job_title: job.title,
      company_name: (company as any)?.name ?? null,
      score: parsed.total,
      recommendation: parsed.recommendation ?? "",
      mode: "live",
      verified: true,
      created_at: new Date().toISOString(),
    }, { merge: true });

    try {
      const firebaseUser = await (await getAdminAuth()).getUser(app.applicant_id);
      const applicantEmail = firebaseUser?.email;
      const profileSnap = await db.collection("profiles").doc(app.applicant_id).get();
      const profileData = profileSnap.exists ? profileSnap.data() : null;
      
      if (applicantEmail) {
        await sendEmail({
          to: applicantEmail,
          subject: `Your Crux interview for ${job.title} is scored`,
          html: `<div style="font-family:ui-sans-serif,Inter,Arial;background:#fafafa;padding:32px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:24px;padding:32px;border:1px solid #eee"><h1 style="font-size:24px;margin:0 0 12px">Interview complete</h1><p style="color:#555;line-height:1.6">Hi ${(profileData as any)?.full_name ?? "there"}, your interview for <b>${job.title}</b> at <b>${(company as any)?.name ?? "the company"}</b> has been scored.</p><div style="margin:24px 0;padding:20px;background:#f5f5f5;border-radius:16px;text-align:center"><div style="font-size:44px;font-weight:700">${Number(parsed.total).toFixed(0)}<span style="font-size:18px;color:#888">/100</span></div><p style="margin:8px 0 0;color:#666;font-size:13px">${parsed.recommendation}</p></div><p style="color:#555;line-height:1.6;font-size:14px">${parsed.summary}</p><p style="color:#999;font-size:12px;margin-top:24px">— The Crux team</p></div></div>`,
        });
      }
      
      if ((company as any)?.owner_id) {
        const ownerFirebaseUser = await (await getAdminAuth()).getUser((company as any).owner_id);
        const recruiterEmail = ownerFirebaseUser?.email;
        if (recruiterEmail) {
          await sendEmail({
            to: recruiterEmail,
            subject: `New candidate scored ${Number(parsed.total).toFixed(0)}/100 for ${job.title}`,
            html: `<div style="font-family:ui-sans-serif,Inter,Arial;background:#fafafa;padding:32px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:24px;padding:32px;border:1px solid #eee"><h1 style="font-size:24px;margin:0 0 12px">New candidate</h1><p style="color:#555;line-height:1.6">A candidate has completed the AI interview for <b>${job.title}</b>.</p><div style="margin:24px 0;padding:20px;background:#f5f5f5;border-radius:16px;text-align:center"><div style="font-size:44px;font-weight:700">${Number(parsed.total).toFixed(0)}<span style="font-size:18px;color:#888">/100</span></div><p style="margin:8px 0 0;color:#666;font-size:13px">${parsed.recommendation}</p></div><p style="color:#555;line-height:1.6;font-size:14px">${parsed.summary}</p><p style="color:#999;font-size:12px;margin-top:24px">Open your Crux dashboard to review the full transcript.</p></div></div>`,
          });
        }
      }
    } catch (e) {
      console.error("notify error", e);
    }

    return { score: parsed.total, summary: parsed.summary, breakdown: parsed.scores, highlights: { strengths: parsed.strengths, concerns: parsed.concerns, recommendation: parsed.recommendation } };
  });

export const setPipelineStage = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    applicationId: z.string(),
    stage: z.enum(["applied", "interviewed", "shortlisted", "offer", "rejected"]),
  }).parse(input))
  .handler(async ({ data }) => {
    const db = await getAdminDb();
    await db.collection("applications").doc(data.applicationId).update({ pipeline_status: data.stage });
    return { ok: true };
  });

export const generateJobOgImage = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    jobId: z.string().optional(),
    title: z.string().optional(),
    companyName: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    // Two modes: by jobId (saves onto the job) or by title/company (preview before the job exists).
    let title = data.title ?? "";
    let companyName = data.companyName ?? "";
    let companyLogo: string | undefined;
    if (data.jobId) {
      const jobSnap = await db.collection("jobs").doc(data.jobId).get();
      if (!jobSnap.exists) throw new Error("Job not found");
      const job = jobSnap.data() as any;
      title = job.title;
      const companySnap = await db.collection("companies").doc(job.company_id).get();
      const company = companySnap.exists ? companySnap.data() as any : null;
      companyName = company?.name ?? "";
      companyLogo = company?.logo_url;
    }
    if (!title) throw new Error("A job title is required to generate a poster");

    // 1. Background image. Try NVIDIA SD3 (genai endpoint); fall back to a clean
    //    gradient so the poster always generates even if the AI image API is down.
    const prompt = `A stunning, professional, ultra-modern abstract gradient background for a job poster titled "${title}" at "${companyName}". High contrast, cinematic lighting, corporate sleek aesthetic. No text.`;
    let bgBuffer: Buffer | null = null;
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (nvidiaKey) {
      try {
        const res = await fetch("https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-medium", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${nvidiaKey}`, Accept: "application/json" },
          body: JSON.stringify({ prompt, cfg_scale: 5, aspect_ratio: "16:9", seed: 0, steps: 30, negative_prompt: "text, watermark, words" }),
        });
        if (res.ok) {
          const j: any = await res.json();
          const b64 = j.image || j.artifacts?.[0]?.base64 || j.data?.[0]?.b64_json;
          if (b64) bgBuffer = Buffer.from(b64, "base64");
        } else {
          console.error(`NVIDIA image ${res.status}: ${await res.text().catch(() => "")}`);
        }
      } catch (e) { console.error("NVIDIA image failed, using gradient fallback", e); }
    }
    if (!bgBuffer) {
      const gradient = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="0.55" stop-color="#0b1020"/><stop offset="1" stop-color="#3730a3"/></linearGradient><radialGradient id="r" cx="80%" cy="20%" r="60%"><stop offset="0" stop-color="#6366f1" stop-opacity="0.45"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#r)"/></svg>`;
      bgBuffer = await sharp(Buffer.from(gradient)).png().toBuffer();
    }

    // 2. Fetch the company logo to composite, or use a default
    let logoBuffer = null;
    if (companyLogo) {
      try {
        const logoRes = await fetch(companyLogo);
        if (logoRes.ok) logoBuffer = Buffer.from(await logoRes.arrayBuffer());
      } catch (e) {}
    }

    // 3. Composite using sharp
    // Use explicit type to match what sharp.toBuffer() returns
    let finalBuffer: Buffer<ArrayBufferLike> = bgBuffer;
    
    try {
      let image = sharp(bgBuffer).resize(1200, 630, { fit: 'cover' });
      const composites: import('sharp').OverlayOptions[] = [];
      
      // Add semi-transparent overlay to make text pop
      composites.push({
        input: Buffer.from(`<svg width="1200" height="630"><rect width="1200" height="630" fill="rgba(0,0,0,0.4)"/></svg>`) as Buffer,
        blend: 'over' as const
      });

      // Add Company Logo if present
      if (logoBuffer) {
        const resizedLogo = await sharp(logoBuffer as Buffer).resize(150, 150, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
        composites.push({
          input: resizedLogo as Buffer,
          gravity: 'northwest',
          top: 60,
          left: 60
        });
      }

      // Add SVG text for Job Title and Company
      const svgText = `
        <svg width="1200" height="630">
          <text x="60" y="320" font-family="sans-serif" font-weight="bold" font-size="64" fill="#ffffff">${title.replace(/&/g, '&amp;')}</text>
          <text x="60" y="400" font-family="sans-serif" font-size="32" fill="#e0e0e0">${companyName.replace(/&/g, '&amp;')}</text>
        </svg>`;
      
      composites.push({
        input: Buffer.from(svgText) as Buffer,
        blend: 'over' as const
      });

      finalBuffer = await image.composite(composites).png().toBuffer();
    } catch (e) {
      console.error("Sharp compositing failed, using original background", e);
    }

    // 4. Save to Firebase Storage
    const adminStorage = getStorage();
    const bucket = adminStorage.bucket();
    const path = data.jobId
      ? `jobs/${data.jobId}/poster.png`
      : `og-previews/${context.userId}/${Date.now()}.png`;
    const destFile = bucket.file(path);

    await destFile.save(finalBuffer, {
      metadata: { contentType: 'image/png' },
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;
    if (data.jobId) await db.collection("jobs").doc(data.jobId).update({ og_image_url: publicUrl });

    return { url: publicUrl };
  });

export const setRetakeAllowed = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    applicationId: z.string(),
    allowed: z.boolean(),
    note: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appSnap = await db.collection("applications").doc(data.applicationId).get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;

    const jobSnap = await db.collection("jobs").doc(app.job_id).get();
    if (!jobSnap.exists) throw new Error("Job not found");
    const job = jobSnap.data() as any;

    const compSnap = await db.collection("companies").doc(job.company_id).get();
    const comp = compSnap.exists ? compSnap.data() : null;
    const ownerId = (comp as any)?.owner_id;
    if (ownerId !== context.userId) throw new Error("Forbidden");
    if (data.allowed && (app.retake_count ?? 0) >= 1) {
      throw new Error("Candidate has already used their retake");
    }
    const entry = {
      at: new Date().toISOString(),
      by: context.userId,
      action: data.allowed ? "retake_granted" : "retake_revoked",
      note: data.note ?? null,
    };
    const log = Array.isArray(app.audit_log) ? app.audit_log : [];
    await db.collection("applications").doc(data.applicationId).update({
      retake_allowed: data.allowed,
      audit_log: [...log, entry],
    });
    return { ok: true };
  });

export const consumeRetake = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const appSnap = await db.collection("applications").doc(data.applicationId).get();
    if (!appSnap.exists) throw new Error("Application not found");
    const app = appSnap.data() as any;
    if (app.applicant_id !== context.userId) throw new Error("Forbidden");
    if (!app.retake_allowed) throw new Error("Retake is not enabled for this application");
    if ((app.retake_count ?? 0) >= 1) throw new Error("Retake already used");

    const interviewsSnap = await db.collection("interviews").where("application_id", "==", data.applicationId).get();
    const batch = db.batch();
    interviewsSnap.forEach(( d: any ) => batch.delete(d.ref));
    await batch.commit();

    const entry = {
      at: new Date().toISOString(),
      by: context.userId,
      action: "retake_consumed",
    };
    const log = Array.isArray(app.audit_log) ? app.audit_log : [];
    await db.collection("applications").doc(data.applicationId).update({
      retake_allowed: false,
      retake_count: (app.retake_count ?? 0) + 1,
      status: "video_uploaded",
      score: null,
      score_breakdown: null,
      score_evidence: null,
      ai_summary: null,
      ai_highlights: null,
      audit_log: [...log, entry],
    });
    return { ok: true };
  });

export const assignRecruiterRoleOnSignup = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .handler(async ({ context }) => {
    const db = await getAdminDb();
    const userDoc = await db.collection("users").doc(context.userId).get();
    const userData = userDoc.data();
    if (userData?.role) {
      throw new Error("Role already assigned");
    }
    await db.collection("users").doc(context.userId).set({ role: "recruiter" }, { merge: true });
    return { ok: true };
  });

// Live-interview TTS via Chatterbox. Returns empty audio when no endpoint is reachable
// or on error, so the interview gracefully falls back to on-screen text.
export const generateSpeech = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ text: z.string(), voice: z.string().optional() }).parse(input))
  .handler(async ({ data }) => {
    try {
      const result = await chatterboxTts(data.text, data.voice);
      if (!result) return { audioBase64: "", mime: "audio/mpeg" };
      return result;
    } catch (e) {
      console.error(e);
      return { audioBase64: "", mime: "audio/mpeg" };
    }
  });

// If the recruiter already wrote a description we ENHANCE it (keep their facts,
// polish clarity/structure); if it's empty we GENERATE one from title + ideal.
export const generateJobDescription = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ title: z.string(), ideal: z.string(), existing: z.string().optional() }).parse(input))
  .handler(async ({ data }) => {
    const hasExisting = (data.existing ?? "").trim().length > 20;
    const ai = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: hasExisting
          ? "You are an expert technical recruiter. Improve and polish the recruiter's EXISTING job description: keep all their facts and intent, fix grammar/clarity, structure into ~3 tight paragraphs, professional and compelling tone. Do not invent perks or requirements they didn't state. Output plain text, no markdown."
          : "You are an expert technical recruiter. Write a compelling, professional, 3-paragraph job description based on the title and ideal profile. Output plain text, no markdown formatting." },
        { role: "user", content: hasExisting
          ? `Title: ${data.title}\nIdeal Profile: ${data.ideal}\n\nExisting description to improve:\n${data.existing}`
          : `Title: ${data.title}\nIdeal Profile: ${data.ideal}` }
      ]
    });
    return { description: ai.choices[0].message.content };
  });

const QUESTION_STYLE_HINT: Record<string, string> = {
  skill: "Probe concrete, role-specific technical skills and hands-on experience.",
  creativity: "Probe creative problem-solving and how they approach open-ended, ambiguous problems.",
  educational: "Probe foundational concepts and knowledge depth — test understanding, not just recall.",
  out_of_box: "Probe lateral, unconventional thinking and how they handle unexpected curveballs.",
};

export const generateJobQuestions = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    title: z.string(), description: z.string(), ideal: z.string(),
    style: z.enum(["skill", "creativity", "educational", "out_of_box", "balanced"]).optional(),
    count: z.number().min(1).max(8).optional(),
  }).parse(input))
  .handler(async ({ data }) => {
    const count = data.count ?? 3;
    const hint = data.style && data.style !== "balanced" ? QUESTION_STYLE_HINT[data.style] : "Mix technical and behavioral angles.";
    const ai = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        { role: "system", content: `You are an expert interviewer. Generate exactly ${count} interview questions for the role. ${hint} Keep each question one sentence, answerable in a short paragraph. Output strictly a JSON object: {"questions": string[]}.` },
        { role: "user", content: `Title: ${data.title}\nDesc: ${data.description}\nIdeal: ${data.ideal}` }
      ],
      response_format: { type: "json_object" }
    });
    let qs: string[] = [];
    try {
      const parsed = extractJson<any>(ai.choices[0].message.content);
      if (Array.isArray(parsed)) qs = parsed;
      else if (parsed.questions && Array.isArray(parsed.questions)) qs = parsed.questions;
    } catch(e) {}
    return { questions: qs.slice(0, count) };
  });

export const generatePostCaption = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ title: z.string(), existingBody: z.string().optional() }).parse(input))
  .handler(async ({ data }) => {
    const ai = await groqChat(GROQ_CHAT_MODEL, {
      messages: [
        {
          role: "system",
          content: "You are an expert technical writer. Write a short, engaging, first-person project description (2-3 sentences max) for a developer portfolio post. Keep it enthusiastic and professional. Output plain text only."
        },
        {
          role: "user",
          content: `Project title: "${data.title}"\n${data.existingBody ? `Existing description: "${data.existingBody}"` : ""}Write a compelling caption for this project.`
        }
      ]
    });
    return { caption: ai.choices[0].message.content.trim() };
  });
