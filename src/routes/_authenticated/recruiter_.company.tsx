import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, getDocs, updateDoc, doc, addDoc, setDoc } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { requestCompanyVerification } from "@/lib/match.server";
import { resolveUsername } from "@/lib/username";
import { toast } from "sonner";
import { ShieldCheck, Plus, Trash2, GripVertical, UserPlus, CheckCircle2, Clock } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

export const Route = createFileRoute("/_authenticated/recruiter_/company")({
  component: CompanySettings,
});

function CompanySettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [pastHires, setPastHires] = useState<{ id: string; name: string; role: string; link: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  const { data: company } = useQuery({
    queryKey: ["my-company-edit", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const q = query(collection(db, "companies"), where("owner_id", "==", user!.id));
      const snap = await getDocs(q);
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
    },
  });

  useEffect(() => {
    if (company) {
      setName(company.name ?? "");
      setDescription(company.description ?? "");
      setWebsite(company.website ?? "");
      setLogoUrl(company.logo_url ?? "");
      setBannerUrl(company.banner_url ?? "");
      setPastHires(company.past_hires ?? []);
    }
  }, [company]);

  async function ensureRecruiterRole() {
    // Canonical role store is users/{uid}.role. Creating a company implies recruiter.
    await setDoc(doc(db, "users", user!.id), { role: "recruiter" }, { merge: true });
  }

  async function handleLogo(file: File) {
    setUploadingLogo(true);
    try {
      const dataUrl = await downscaleToDataUrl(file, 256, 0.85);
      setLogoUrl(dataUrl);
      toast.success("Logo set — click Save to keep it");
    } catch (e: any) {
      toast.error(`Couldn't process image: ${e?.message ?? "unknown"}`);
    } finally { setUploadingLogo(false); }
  }

  async function handleBanner(file: File) {
    setUploadingBanner(true);
    try {
      const dataUrl = await downscaleToDataUrl(file, 1280, 0.8);
      if (dataUrl.length > 900_000) {
        toast.error("Banner too large after compression — try a simpler image");
        return;
      }
      setBannerUrl(dataUrl);
      toast.success("Banner set — click Save to keep it");
    } catch (e: any) {
      toast.error(`Couldn't process image: ${e?.message ?? "unknown"}`);
    } finally { setUploadingBanner(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await ensureRecruiterRole();
      if (company) {
        await updateDoc(doc(db, "companies", company.id), { name, description, website, logo_url: logoUrl, banner_url: bannerUrl, past_hires: pastHires });
        toast.success("Company updated");
      } else {
        await addDoc(collection(db, "companies"), { owner_id: user!.id, name, description, website, logo_url: logoUrl, banner_url: bannerUrl, past_hires: pastHires });
        toast.success("Company created");
      }
      navigate({ to: "/recruiter" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally { setBusy(false); }
  }
  
  const handleDragEnd = (result: any, list: any[], setList: any) => {
    if (!result.destination) return;
    const items = Array.from(list);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setList(items);
  };

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-2xl px-4 py-10 pb-32">
        <h1 className="font-display text-3xl font-bold tracking-tight">{company ? "Edit company" : "Create your company"}</h1>
        <form onSubmit={save} className="glass-strong mt-6 space-y-6 rounded-3xl p-7">
          <Field label="Company name">
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="About">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="input resize-none" />
          </Field>
          <Field label="Website">
            <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className="input" />
          </Field>
          <Field label="Profile banner">
            <div className="mt-2 space-y-3">
              <div className="relative h-32 w-full overflow-hidden rounded-2xl border border-border bg-secondary/60">
                {bannerUrl ? (
                  <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No banner yet — wide image recommended (e.g. 1600×400)</div>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary/60">
                {uploadingBanner ? "Uploading…" : bannerUrl ? "Replace banner" : "Upload banner"}
                <input type="file" accept="image/*" disabled={uploadingBanner} onChange={(e) => e.target.files?.[0] && handleBanner(e.target.files[0])} className="hidden" />
              </label>
              {bannerUrl && (
                <button type="button" onClick={() => setBannerUrl("")} className="ml-2 text-xs text-muted-foreground underline hover:text-foreground">Remove</button>
              )}
            </div>
          </Field>
          <Field label="Logo">
            <div className="mt-2 flex items-center gap-4">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-16 w-16 rounded-xl object-cover shadow-sm" />
              ) : (
                <div className="h-16 w-16 rounded-xl bg-secondary/80 flex items-center justify-center text-muted-foreground shadow-sm">
                  <Plus className="h-6 w-6" />
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary/60">
                {uploadingLogo ? "Uploading…" : "Upload image"}
                <input type="file" accept="image/*" disabled={uploadingLogo} onChange={(e) => e.target.files?.[0] && handleLogo(e.target.files[0])} className="hidden" />
              </label>
            </div>
          </Field>
          
          <div className="pt-4 border-t border-border/60">
            <div className="flex items-center justify-between mb-4">
              <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Past Recruits</label>
              <button type="button" onClick={() => setPastHires([...pastHires, { id: Date.now().toString(), name: "", role: "", link: "" }])} className="text-primary hover:opacity-80"><Plus className="h-4 w-4" /></button>
            </div>
            <DragDropContext onDragEnd={(res) => handleDragEnd(res, pastHires, setPastHires)}>
              <Droppable droppableId="hires-list">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                    {pastHires.map((hire, index) => (
                      <Draggable key={hire.id} draggableId={hire.id} index={index}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} style={provided.draggableProps.style as React.CSSProperties} className="flex flex-col gap-2 rounded-2xl border border-border bg-background/40 p-3 sm:flex-row sm:items-center">
                            <div {...provided.dragHandleProps} className="hidden p-2 text-muted-foreground hover:text-foreground sm:block"><GripVertical className="h-4 w-4" /></div>
                            <div className="flex-1 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <input value={hire.name} onChange={(e) => { const n = [...pastHires]; n[index].name = e.target.value; setPastHires(n); }} placeholder="Employee Name" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                                <input value={hire.role} onChange={(e) => { const n = [...pastHires]; n[index].role = e.target.value; setPastHires(n); }} placeholder="Role (e.g. Lead Engineer)" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                              </div>
                              <input value={hire.link} onChange={(e) => { const n = [...pastHires]; n[index].link = e.target.value; setPastHires(n); }} placeholder="LinkedIn URL" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                            </div>
                            <button type="button" onClick={() => setPastHires(pastHires.filter((_, i) => i !== index))} className="self-end p-2 text-destructive hover:opacity-80 sm:self-auto"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
            <p className="mt-2 text-xs text-muted-foreground">Add notable past hires to build trust and showcase your successful placements.</p>
          </div>

          <button disabled={busy} className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? "Saving…" : company ? "Save changes" : "Create company"}
          </button>
        </form>

        {company && <VerificationCard company={company} />}

        <VerifiedRecruitsCard />

        <style>{`.input { width:100%; border-radius: 1rem; border: 1px solid var(--color-border); background: oklch(1 0 0 / 0.6); padding: 0.7rem 1rem; font-size: 0.875rem; outline: none; transition: border-color 0.15s; } .input:focus { border-color: oklch(0.12 0 0 / 0.3); }`}</style>
      </main>
    </div>
  );
}

type CompanyRow = { id: string; name: string; website: string | null; verification_status: string | null };

function VerificationCard({ company }: { company: CompanyRow }) {
  const qc = useQueryClient();
  const requestFn = useServerFn(requestCompanyVerification);
  const [domain, setDomain] = useState(() => {
    try { return company.website ? new URL(company.website).host.replace(/^www\./, "") : ""; } catch { return ""; }
  });
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");

  const submit = useMutation({
    mutationFn: () => requestFn({ data: { companyId: company.id, domain: domain || undefined, evidenceUrl: evidence || undefined, notes: notes || undefined } }),
    onSuccess: () => {
      toast.success("Verification requested — admins will review shortly");
      qc.invalidateQueries({ queryKey: ["my-company-edit"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const status = company.verification_status ?? "unverified";

  return (
    <div className="glass-strong mt-4 rounded-3xl p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Verification</h2>
        {status === "verified" ? <VerifiedBadge status="verified" /> :
          <span className={`rounded-full px-2 py-0.5 text-[10px] capitalize ${status === "pending" ? "bg-amber-500/10 text-amber-700" : status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"}`}>{status}</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Verified companies get a badge on every job post and rank slightly higher in candidate feeds.
      </p>

      {status === "verified" && <p className="mt-4 text-sm text-foreground/70">You're verified — nothing to do here.</p>}
      {status === "pending" && <p className="mt-4 text-sm text-foreground/70">Pending admin review.</p>}
      {(status === "unverified" || status === "rejected") && (
        <form
          onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}
          className="mt-4 space-y-3"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Company domain</span>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" className="input" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Evidence URL (LinkedIn page, registry, press)</span>
            <input type="url" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://" className="input" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input resize-none" placeholder="Anything that helps us verify your company." />
          </label>
          <button disabled={submit.isPending} className="w-full rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60">
            {submit.isPending ? "Submitting…" : "Request verification"}
          </button>
        </form>
      )}
    </div>
  );
}

// Downscale + compress an image entirely in the browser and return a data URL.
// Lets us store small images directly in Firestore (no paid Cloud Storage needed).
function downscaleToDataUrl(file: File, maxDim: number, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("Not an image")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas unsupported")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function VerifiedRecruitsCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [handle, setHandle] = useState("");

  const { data: claims } = useQuery({
    queryKey: ["my-recruits", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "recruitment_claims"), where("recruiter_id", "==", user!.id)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as any)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const uname = handle.trim().replace(/^@/, "").toLowerCase();
      if (!uname) throw new Error("Enter their Crux username");
      const memberId = await resolveUsername(uname);
      if (!memberId) throw new Error("No Crux user with that username");
      if (memberId === user!.id) throw new Error("You can't tag yourself");
      if ((claims ?? []).some((c) => c.member_id === memberId && c.status !== "rejected")) {
        throw new Error("You've already tagged this person");
      }
      await addDoc(collection(db, "recruitment_claims"), {
        recruiter_id: user!.id,
        member_id: memberId,
        member_username: uname,
        status: "pending",
        created_at: new Date().toISOString(),
      });
    },
    onSuccess: () => { toast.success("Request sent — it counts once they approve"); setHandle(""); qc.invalidateQueries({ queryKey: ["my-recruits"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const approved = (claims ?? []).filter((c) => c.status === "approved").length;

  return (
    <div className="glass-strong mt-4 rounded-3xl p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold flex items-center gap-2"><UserPlus className="h-4 w-4" /> Verified recruits</h2>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{approved} verified</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Tag people you've hired by their Crux username. It only counts after they confirm — so the number is trustworthy.</p>
      <div className="mt-4 flex gap-2">
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="their-username" className="input flex-1" />
        <button disabled={add.isPending || !handle.trim()} onClick={() => add.mutate()} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{add.isPending ? "Sending…" : "Tag hire"}</button>
      </div>
      {claims && claims.length > 0 && (
        <ul className="mt-4 space-y-2">
          {claims.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-2xl bg-background/40 px-4 py-2.5 text-sm">
              <span>@{c.member_username ?? c.member_id.slice(0, 6)}</span>
              <span className={`inline-flex items-center gap-1 text-xs capitalize ${c.status === "approved" ? "text-primary" : c.status === "rejected" ? "text-destructive" : "text-muted-foreground"}`}>
                {c.status === "approved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />} {c.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
