import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateBrandIdentity } from "@/lib/brand.server";
import { Palette, Sparkles, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

type Params = {
  brandName: string; description: string; targetAge: string; feel: string;
  inspiredFrom: string; colours: string; graphicStyles: string; avoid: string;
};

const FIELDS: { key: keyof Params; label: string; placeholder: string; area?: boolean }[] = [
  { key: "brandName", label: "Brand name", placeholder: "e.g. Nimbus AI" },
  { key: "description", label: "Description", placeholder: "What the brand does, in a sentence or two", area: true },
  { key: "targetAge", label: "Target age group", placeholder: "e.g. 22–35, early-career engineers" },
  { key: "feel", label: "Brand feel", placeholder: "e.g. bold, trustworthy, modern" },
  { key: "inspiredFrom", label: "Inspired from", placeholder: "e.g. Linear, Stripe, Notion" },
  { key: "colours", label: "Colours", placeholder: "e.g. deep indigo, off-white, electric blue" },
  { key: "graphicStyles", label: "Graphic styles", placeholder: "e.g. clean geometric, subtle gradients" },
  { key: "avoid", label: "Avoid", placeholder: "e.g. clip-art, neon, clutter" },
];

export function BrandIdentity({ company }: { company: any }) {
  const genFn = useServerFn(generateBrandIdentity);
  const init: Params = {
    brandName: company?.brand_params?.brandName || company?.name || "",
    description: company?.brand_params?.description || company?.description || "",
    targetAge: company?.brand_params?.targetAge || "",
    feel: company?.brand_params?.feel || "",
    inspiredFrom: company?.brand_params?.inspiredFrom || "",
    colours: company?.brand_params?.colours || "",
    graphicStyles: company?.brand_params?.graphicStyles || "",
    avoid: company?.brand_params?.avoid || "",
  };
  const [params, setParams] = useState<Params>(init);
  const [url, setUrl] = useState<string>(company?.brand_identity_url || "");
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!params.brandName.trim()) { toast.error("Add a brand name first"); return; }
    setBusy(true);
    try {
      const res: any = await genFn({ data: { companyId: company.id, params } });
      setUrl(res.url);
      toast.success("Brand identity generated");
    } catch (e: any) { toast.error(e?.message ?? "Failed to generate"); }
    finally { setBusy(false); }
  }

  const set = (k: keyof Params, v: string) => setParams((p) => ({ ...p, [k]: v }));

  return (
    <section className="glass-strong rounded-3xl p-7">
      <div className="flex items-center gap-2">
        <Palette className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-semibold">Company brand theme</h2>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3 w-3" /> Private to you — used to generate on-brand job posters.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className={f.area ? "sm:col-span-2" : ""}>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{f.label}</span>
            {f.area ? (
              <textarea value={params[f.key]} onChange={(e) => set(f.key, e.target.value)} rows={2} placeholder={f.placeholder} className="w-full resize-none rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30" />
            ) : (
              <input value={params[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className="w-full rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30" />
            )}
          </label>
        ))}
      </div>

      <button onClick={generate} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {url ? "Regenerate brand identity" : "Generate brand identity"}
      </button>

      {url && (
        <div className="mt-5">
          <img src={url} alt="Brand identity" className="w-full rounded-2xl border border-border" />
          <p className="mt-2 text-xs text-muted-foreground">Edit the fields above and regenerate anytime. This board guides your AI job posters.</p>
        </div>
      )}
    </section>
  );
}
