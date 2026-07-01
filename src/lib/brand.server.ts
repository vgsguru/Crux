import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";
import { getAdminDb } from "@/integrations/firebase/admin";
import { putImageToBlob } from "@/lib/blob.server";
import { generateImage, generateBrandBoard } from "@/lib/image-gen.server";

// Decode a logo URL (data-URI or http) into a Buffer for image-edit reference.
async function fetchImageBuffer(url?: string): Promise<Buffer | null> {
  if (!url) return null;
  try {
    if (url.startsWith("data:")) { const b64 = url.split(",")[1]; return b64 ? Buffer.from(b64, "base64") : null; }
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
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
    const company = await requireCompanyOwner(db, data.companyId, context.userId);
    const p = data.params;
    const prompt = `Design ONE polished, agency-style BRAND IDENTITY GUIDELINE BOARD as a single high-resolution image on a dark background. Lay it out in clearly labelled sections: THE MARK (the logo + a one-line meaning), TYPOGRAPHY (an alphabet + numerals sample), COLOUR PALETTE (hex colour swatches), APPLICATIONS (realistic product mockups — the app UI on a phone, business cards, apparel like a hoodie and cap, a tote bag, a water bottle), PACKAGING (a branded box), and a MOOD strip of on-brand photos. Cohesive, premium, high detail, real product-photography style for mockups. No lorem-ipsum gibberish text.
Brand Name: ${p.brandName}
Brand Description: ${p.description ?? ""}
Target Age Group: ${p.targetAge ?? ""}
Brand Feel: ${p.feel ?? ""}
Inspired from: ${p.inspiredFrom ?? ""}
Colours: ${p.colours ?? ""}
Graphic Styles: ${p.graphicStyles ?? ""}
Avoid: ${p.avoid ?? ""}
Use the provided logo exactly and consistently across every application in the board.`;

    const logo = await fetchImageBuffer(company.logo_url);
    const buf = await generateBrandBoard(prompt, logo);
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
    jobTitle: z.string().optional(),
    jobDescription: z.string().optional(),
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
    const prompt = `Design a scroll-stopping "we're hiring" social media poster for a ${data.jobTitle ?? "job"} role at ${brand.brandName ?? company.name ?? "the company"}, cohesive with the brand's identity.
Role: ${data.jobTitle ?? ""}. About the role: ${(data.jobDescription ?? "").slice(0, 300)}
Brand feel: ${brand.feel ?? ""}. Brand colours: ${brand.colours ?? ""}.
Target Age Group: ${data.targetAge ?? ""}
Creative Feel: ${data.feel ?? ""}
Inspired from: ${data.inspiredFrom ?? ""}
Graphic Styles: ${data.graphicStyles ?? brand.graphicStyles ?? ""}
Product/subject in focus: ${data.productInFocus || data.jobTitle || "the role"}
Professional, premium, high detail. Include a bold "We're hiring: ${data.jobTitle ?? ""}" style headline. Leave clean negative space in one corner.`;

    let buf = await generateImage(prompt, 1024, 768);
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
