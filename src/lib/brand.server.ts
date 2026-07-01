import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { getAdminDb } from "@/integrations/firebase/admin";
import { putImageToBlob } from "@/lib/blob.server";

// Text→image via NVIDIA FLUX.1-dev (SD3 endpoint was removed). Returns a buffer or null.
// flux.1-dev requires width/height from a fixed set (768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344).
async function nvidiaImage(prompt: string, width: number, height: number): Promise<Buffer | null> {
  const key = process.env.NVIDIA_FLUX_API_KEY || process.env.NVIDIA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 1500), width, height, steps: 40, cfg_scale: 3.5, seed: 0 }),
    });
    if (!res.ok) { console.error("nvidia img", res.status, await res.text().catch(() => "")); return null; }
    const j: any = await res.json();
    const b64 = j.image || j.artifacts?.[0]?.base64 || j.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch (e) { console.error("nvidia img err", e); return null; }
}

// Instruction-based image editing via FLUX.1 Kontext (NVIDIA). Uses NVIDIA's asset
// flow: register → upload → reference as `data:image/jpeg;example_id,<id>`. Returns
// the edited PNG buffer, or null on any failure (callers fall back gracefully).
// NOTE: NVIDIA's kontext endpoint has been returning 500s during preview — the
// fallback keeps posters working until it stabilises.
async function fluxEditImage(imageBuffer: Buffer, prompt: string): Promise<Buffer | null> {
  const key = process.env.NVIDIA_FLUX_API_KEY || process.env.NVIDIA_API_KEY;
  if (!key) return null;
  try {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(imageBuffer).resize(1024, 1024, { fit: "cover" }).jpeg().toBuffer();
    // 1. Register + 2. upload the input asset.
    const reg = await fetch("https://api.nvcf.nvidia.com/v2/nvcf/assets", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ contentType: "image/jpeg", description: "crux-edit" }),
    });
    if (!reg.ok) return null;
    const rj: any = await reg.json();
    const up = await fetch(rj.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg", "x-amz-meta-nvcf-asset-description": "crux-edit" }, body: new Uint8Array(jpeg) });
    if (!up.ok) return null;
    // 3. Edit.
    const res = await fetch("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", "NVCF-INPUT-ASSET-REFERENCES": rj.assetId },
      body: JSON.stringify({ prompt: prompt.slice(0, 900), image: `data:image/jpeg;example_id,${rj.assetId}`, width: 1024, height: 1024, steps: 30, cfg_scale: 3.5, seed: 0 }),
    });
    if (!res.ok) { console.error("flux kontext", res.status, (await res.text().catch(() => "")).slice(0, 120)); return null; }
    const j: any = await res.json();
    const b64 = j.image || j.artifacts?.[0]?.base64 || j.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch (e) { console.error("flux edit err", e); return null; }
}

async function requireCompanyOwner(db: FirebaseFirestore.Firestore, companyId: string, uid: string) {
  const snap = await db.collection("companies").doc(companyId).get();
  if (!snap.exists || (snap.data() as any).owner_id !== uid) throw new Error("Forbidden");
  return snap.data() as any;
}

const BRAND_PARAMS = z.object({
  brandName: z.string().min(1),
  description: z.string().optional(),
  targetAge: z.string().optional(),
  feel: z.string().optional(),
  inspiredFrom: z.string().optional(),
  colours: z.string().optional(),
  graphicStyles: z.string().optional(),
  avoid: z.string().optional(),
});

// Generate a brand identity concept board and store it on the company (owner-only).
export const generateBrandIdentity = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((i: unknown) => z.object({ companyId: z.string(), params: BRAND_PARAMS }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    await requireCompanyOwner(db, data.companyId, context.userId);
    const p = data.params;
    const prompt = `Create a complete brand identity concept board. The image must contain: the logo, a few logo variations, a colour palette (swatches), typography samples, and simple product/merch/packaging mockups. Clean studio flat-lay presentation, cohesive, high detail, professional.
Brand Name: ${p.brandName}
Description: ${p.description ?? ""}
Target Age Group: ${p.targetAge ?? ""}
Brand Feel: ${p.feel ?? ""}
Inspired from: ${p.inspiredFrom ?? ""}
Colours: ${p.colours ?? ""}
Graphic Styles: ${p.graphicStyles ?? ""}
Avoid: ${p.avoid ?? ""}`;

    const buf = await nvidiaImage(prompt, 1024, 1024);
    if (!buf) throw new Error("Image generation is busy — please try again in a moment.");

    const url = await putImageToBlob(buf, `brand/${data.companyId}/identity-${Date.now()}.png`, "image/png");
    await db.collection("companies").doc(data.companyId).update({ brand_identity_url: url, brand_params: p, brand_updated_at: new Date().toISOString() });
    return { url };
  });

// Generate a brand-consistent, scroll-stopping social creative (4:3) with a subtle Crux mark.
export const generateBrandPoster = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((i: unknown) => z.object({
    companyId: z.string(),
    targetAge: z.string().optional(),
    feel: z.string().optional(),
    inspiredFrom: z.string().optional(),
    graphicStyles: z.string().optional(),
    productInFocus: z.string().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const company = await requireCompanyOwner(db, data.companyId, context.userId);
    const brand = company.brand_params ?? {};
    const prompt = `Using this brand guideline as reference, create a scroll-stopping social media creative poster, cohesive with the brand identity.
Brand: ${brand.brandName ?? company.name ?? ""}. Brand feel: ${brand.feel ?? ""}. Brand colours: ${brand.colours ?? ""}.
Target Age Group: ${data.targetAge ?? ""}
Creative Feel: ${data.feel ?? ""}
Inspired from: ${data.inspiredFrom ?? ""}
Graphic Styles: ${data.graphicStyles ?? brand.graphicStyles ?? ""}
Product in focus: ${data.productInFocus ?? ""}
Professional, premium, high detail. Leave clean negative space in one corner.`;

    let buf = await nvidiaImage(prompt, 1024, 768);
    const sharp = (await import("sharp")).default;
    if (!buf) {
      const g = `<svg width="1024" height="768"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs><rect width="1024" height="768" fill="url(#g)"/></svg>`;
      buf = await sharp(Buffer.from(g)).png().toBuffer();
    }
    // Composite a small, subtle "crux" wordmark in the bottom-right corner.
    const img = sharp(buf).resize(1024, 768, { fit: "cover" });
    const mark = Buffer.from(`<svg width="1024" height="768"><text x="1000" y="744" text-anchor="end" font-family="sans-serif" font-weight="700" font-size="26" fill="#ffffff" fill-opacity="0.82">crux</text></svg>`);
    const final = await img.composite([{ input: mark, blend: "over" }]).png().toBuffer();

    const url = await putImageToBlob(final, `brand-posters/${context.userId}/${Date.now()}.png`, "image/png");
    return { url };
  });

// Edit an existing poster/image with a text instruction via FLUX.1 Kontext.
export const fluxEditPoster = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((i: unknown) => z.object({ imageUrl: z.string().url(), prompt: z.string().min(1).max(900) }).parse(i))
  .handler(async ({ data, context }) => {
    const r = await fetch(data.imageUrl);
    if (!r.ok) throw new Error("Couldn't load that image");
    const edited = await fluxEditImage(Buffer.from(await r.arrayBuffer()), data.prompt);
    if (!edited) throw new Error("FLUX edit is unavailable right now (NVIDIA endpoint error) — please try again later.");
    const sharp = (await import("sharp")).default;
    const png = await sharp(edited).png().toBuffer();
    const url = await putImageToBlob(png, `brand-posters/${context.userId}/edit-${Date.now()}.png`, "image/png");
    return { url };
  });
