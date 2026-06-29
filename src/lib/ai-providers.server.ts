// Centralized AI / email provider helpers.
//
// The app talks to providers DIRECTLY (no Lovable AI gateway):
//   - Groq        → chat completions + Whisper transcription
//   - Gemini      → multimodal chat (PDF/resume parsing) + text embeddings
//   - Resend      → transactional email
//
// Keeping these in one module avoids the copy-pasted helpers that previously
// drifted across every *.server.ts file (and silently still pointed at the
// decommissioned Lovable gateway).

// Groq's llama-3.1-70b-versatile was decommissioned; 3.3 is the drop-in successor.
export const GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";

export async function groqChat(model: string, body: Record<string, unknown>) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY");
  const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, ...body }),
  });
  if (!res.ok) throw new Error(`Groq AI error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ choices: Array<{ message: { content: string } }> }>;
}

export async function geminiChat(
  system: string,
  userText: string,
  fileBase64?: string,
  mimeType?: string,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const parts: any[] = [{ text: userText }];
  if (fileBase64 && mimeType) parts.push({ inlineData: { mimeType, data: fileBase64 } });

  // gemini-1.5-flash is retired; default to a current model (overridable via env).
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini AI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// Transcribe audio/video via Groq Whisper. Accepts base64 + mime, returns text.
export async function groqTranscribe(audioBase64: string, mime: string): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY");
  const buffer = Buffer.from(audioBase64, "base64");
  const blob = new Blob([buffer], { type: mime });
  const ext = mime.includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-large-v3");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form as any,
  });
  if (!res.ok) throw new Error(`Groq Whisper error ${res.status}: ${await res.text()}`);
  const result = await res.json();
  return (result.text ?? "") as string;
}

// Text embeddings via NVIDIA NIM (nv-embedqa-e5-v5). Job and profile embeddings
// both use the same model + input_type, so cosine similarity stays consistent.
export async function embed(text: string): Promise<number[]> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("Missing NVIDIA_API_KEY");
  const model = process.env.NVIDIA_EMBED_MODEL || "nvidia/nv-embedqa-e5-v5";
  const res = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: [text.slice(0, 8000)], model, input_type: "passage" }),
  });
  if (!res.ok) throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

// Text-to-speech via Chatterbox (Resemble AI's open-source TTS, typically self-hosted).
// Works with any Chatterbox HTTP endpoint that accepts JSON and returns audio bytes —
// the popular `chatterbox-tts-api` wrapper is OpenAI-speech compatible
// (POST /v1/audio/speech with { input, voice, response_format }).
//
// Config (all optional — returns null if no URL, so callers fall back to on-screen text):
//   CHATTERBOX_API_URL   full endpoint, e.g. http://localhost:4123/v1/audio/speech
//   CHATTERBOX_API_KEY   bearer token, if your server requires one
//   CHATTERBOX_VOICE     default voice/speaker id
export async function chatterboxTts(
  text: string,
  voice?: string,
): Promise<{ audioBase64: string; mime: string } | null> {
  const url = process.env.CHATTERBOX_API_URL || "http://localhost:4123/v1/audio/speech";
  if (!url) return null;
  const key = process.env.CHATTERBOX_API_KEY;
  const v = voice || process.env.CHATTERBOX_VOICE || "default";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: "chatterbox",
      input: text.slice(0, 2000),
      voice: v,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`Chatterbox TTS error ${res.status}: ${await res.text()}`);

  const ct = res.headers.get("content-type") ?? "";
  // Most wrappers stream raw audio bytes; some return JSON with a base64 field.
  if (ct.includes("application/json")) {
    const data: any = await res.json();
    const b64 = data.audio || data.audioBase64 || data.audio_base64 || data.data;
    if (!b64) return null;
    return { audioBase64: b64, mime: data.mime || "audio/mpeg" };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) return null;
  const mime = ct.includes("wav") ? "audio/wav" : ct.includes("ogg") ? "audio/ogg" : "audio/mpeg";
  return { audioBase64: buf.toString("base64"), mime };
}

export function extractJson<T>(text: string): T {
  const m = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/```\s*([\s\S]*?)```/);
  return JSON.parse(m ? m[1] : text) as T;
}

// Strip obvious PII before sending transcripts to the grader (fair, evidence-based scoring).
export function redactPII(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email redacted]")
    .replace(/\+?\d[\d\s\-().]{7,}\d/g, "[phone redacted]")
    .replace(/^(Name|Full Name|Candidate)[:\s].*$/gim, "[name redacted]");
}

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { skipped: true as const };
  try {
    const res = await fetch(`https://api.resend.com/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "Crux <onboarding@resend.dev>",
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      console.error("Resend failed:", res.status, await res.text().catch(() => ""));
      return { sent: false as const, status: res.status };
    }
    return { sent: true as const };
  } catch (e) {
    console.error("Email send error:", e);
    return { error: true as const };
  }
}
