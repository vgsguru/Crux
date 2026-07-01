// Free text→image generation. Tries Gemini (gemini-2.5-flash-image / "Nano Banana")
// first; falls back to Pollinations (free, no key) when Gemini is quota-limited or
// down. Returns a normalized PNG buffer, or null if both fail.

async function geminiImage(prompt: string): Promise<Buffer | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!res.ok) { console.error("gemini image", res.status); return null; }
    const j: any = await res.json();
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    const d = parts.map((p: any) => p.inlineData || p.inline_data).find(Boolean);
    return d?.data ? Buffer.from(d.data, "base64") : null;
  } catch (e) { console.error("gemini image err", e); return null; }
}

async function pollinationsImage(prompt: string, width: number, height: number): Promise<Buffer | null> {
  try {
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1200))}?width=${width}&height=${height}&nologo=true&model=flux&seed=${seed}`;
    const res = await fetch(url);
    if (!res.ok) { console.error("pollinations", res.status); return null; }
    if (!(res.headers.get("content-type") || "").startsWith("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) { console.error("pollinations err", e); return null; }
}

// OpenAI image generation (gpt-image-1, with dall-e-3 fallback). gpt-image-1 can take
// the company logo as a reference via /images/edits so the board uses the real mark.
// NOTE: gpt-image-1 needs OpenAI org verification; the account needs billing/credits.
async function openaiImage(prompt: string, size: string, logo?: Buffer | null): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const p = prompt.slice(0, 3900);
  try {
    // With a logo → edit (keeps the real mark).
    if (logo && logo.length) {
      const fd = new FormData();
      fd.append("model", "gpt-image-1");
      fd.append("prompt", p);
      fd.append("size", size);
      fd.append("image", new Blob([new Uint8Array(logo)], { type: "image/png" }), "logo.png");
      const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
      if (res.ok) { const j: any = await res.json(); const b = j.data?.[0]?.b64_json; if (b) return Buffer.from(b, "base64"); }
      else console.error("openai edit", res.status, (await res.text().catch(() => "")).slice(0, 160));
    }
    // Otherwise (or edit failed) → generate.
    for (const model of ["gpt-image-1", "dall-e-3"]) {
      const body: any = { model, prompt: p, size };
      if (model === "dall-e-3") body.response_format = "b64_json";
      const res = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { const j: any = await res.json(); const b = j.data?.[0]?.b64_json; if (b) return Buffer.from(b, "base64"); }
      else console.error("openai gen", model, res.status, (await res.text().catch(() => "")).slice(0, 120));
    }
    return null;
  } catch (e) { console.error("openai image err", e); return null; }
}

// Premium brand-board generation: OpenAI (best, uses the logo) → Gemini/Pollinations.
export async function generateBrandBoard(prompt: string, logo?: Buffer | null): Promise<Buffer | null> {
  const buf = await openaiImage(prompt, "1024x1024", logo);
  if (buf) return buf;
  return generateImage(prompt, 1024, 1024);
}

export async function generateImage(prompt: string, width: number, height: number): Promise<Buffer | null> {
  let buf = await geminiImage(prompt);
  if (!buf) buf = await pollinationsImage(prompt, width, height);
  if (!buf) return null;
  // Normalize to PNG so downstream storage/content-type is consistent.
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buf).png().toBuffer();
  } catch { return buf; }
}
