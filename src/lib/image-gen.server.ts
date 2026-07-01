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
