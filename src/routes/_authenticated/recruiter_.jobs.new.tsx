import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { db, storage } from "@/integrations/firebase/client";
import { collection, query, where, getDocs, addDoc, getDoc, doc } from "firebase/firestore";
import { uploadToBlob } from "@/lib/upload";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, ImagePlus, Video, Sparkles, X } from "lucide-react";
import { generateJobOgImage, generateJobDescription, generateJobQuestions } from "@/lib/ai.server";
import { embedJob } from "@/lib/match.server";
import { notifyFollowers, notifyMatchingApplicants } from "@/lib/applications.server";
import { generateBrandPoster } from "@/lib/brand.server";
import { screenJobPost } from "@/lib/moderation";

export const Route = createFileRoute("/_authenticated/recruiter_/jobs/new")({
  component: NewJob,
});


type Rubric = { skills: number; experience: number; communication: number; culture_fit: number };

function NewJob() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const genOg = useServerFn(generateJobOgImage);
  const genDesc = useServerFn(generateJobDescription);
  const genQs = useServerFn(generateJobQuestions);
  const embed = useServerFn(embedJob);
  const notifyFollowersFn = useServerFn(notifyFollowers);
  const notifyMatchesFn = useServerFn(notifyMatchingApplicants);
  const { data: company } = useQuery({
    queryKey: ["my-company-new-job", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const q = query(collection(db, "companies"), where("owner_id", "==", user!.id));
      const snap = await getDocs(q);
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ideal, setIdeal] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [interviewMode, setInterviewMode] = useState("async");
  const [interviewFocus, setInterviewFocus] = useState("");
  const [salary, setSalary] = useState("");
  const [questions, setQuestions] = useState<string[]>(["Tell us about a project you're proud of."]);
  const [questionStyle, setQuestionStyle] = useState("balanced");
  const [rubric, setRubric] = useState<Rubric>({ skills: 25, experience: 25, communication: 25, culture_fit: 25 });
  const [busy, setBusy] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  // Media + AI poster
  const [media, setMedia] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [poster, setPoster] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [genningPoster, setGenningPoster] = useState(false);

  // Draft autosave — lets a recruiter close mid-post and continue later.
  const DRAFT_KEY = "crux_job_draft";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d.title && !d.description) return;
      setTitle(d.title ?? ""); setDescription(d.description ?? ""); setIdeal(d.ideal ?? "");
      setLocation(d.location ?? ""); setEmploymentType(d.employmentType ?? "full_time");
      setInterviewMode(d.interviewMode ?? "async"); setInterviewFocus(d.interviewFocus ?? "");
      setSalary(d.salary ?? ""); setQuestionStyle(d.questionStyle ?? "balanced");
      if (Array.isArray(d.questions) && d.questions.length) setQuestions(d.questions);
      if (d.rubric) setRubric(d.rubric);
      toast.message("Draft restored — continuing where you left off", {
        action: { label: "Discard", onClick: () => { localStorage.removeItem(DRAFT_KEY); window.location.reload(); } },
      });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!title.trim() && !description.trim()) return; // don't save an empty draft
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, description, ideal, location, employmentType, interviewMode, interviewFocus, salary, questionStyle, questions, rubric }));
    } catch { /* ignore */ }
  }, [title, description, ideal, location, employmentType, interviewMode, interviewFocus, salary, questionStyle, questions, rubric]);

  const genBrandFn = useServerFn(generateBrandPoster);
  const [showBrand, setShowBrand] = useState(false);
  const [genBrand, setGenBrand] = useState(false);
  const [brandPoster, setBrandPoster] = useState({ targetAge: "", feel: "", inspiredFrom: "", graphicStyles: "", productInFocus: "" });
  async function generateOnBrandPoster() {
    if (!company) { toast.error("Create your company first"); return; }
    setGenBrand(true);
    try {
      const res: any = await genBrandFn({ data: { companyId: company.id, jobTitle: title, jobDescription: description, ...brandPoster } });
      if (res?.url) { setPoster(res.url); setShowBrand(false); toast.success("On-brand poster generated"); }
      else toast.error("No image returned");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setGenBrand(false); }
  }

  async function uploadFile(file: File, folder: string) {
    return uploadToBlob(file, `${folder}/${user!.id}`);
  }

  async function addImages(files: FileList) {
    setUploadingMedia(true);
    try {
      const urls = await Promise.all([...files].slice(0, 4).map((f) => uploadFile(f, "job-media")));
      setMedia((m) => [...m, ...urls].slice(0, 4));
    } catch (e: any) { toast.error(e?.message ?? "Upload failed — is Storage enabled?"); }
    finally { setUploadingMedia(false); }
  }

  async function addVideo(file: File) {
    if (file.size > 100 * 1024 * 1024) { toast.error("Video must be under 100 MB"); return; }
    setUploadingMedia(true);
    try { setVideoUrl(await uploadFile(file, "job-videos")); }
    catch (e: any) { toast.error(e?.message ?? "Upload failed — is Storage enabled?"); }
    finally { setUploadingMedia(false); }
  }

  async function generatePoster() {
    if (!title.trim()) { toast.error("Enter a job title first"); return; }
    setGenningPoster(true);
    try {
      const res = await genOg({ data: { title, companyName: company?.name } }) as { url?: string };
      if (res?.url) { setPoster(res.url); toast.success("AI poster generated"); }
      else toast.error("No image returned");
    } catch (e: any) { toast.error("Poster failed: " + (e?.message ?? "")); }
    finally { setGenningPoster(false); }
  }

  async function handleGenerateDesc() {
    if (!title) { toast.error("Please enter a job title first"); return; }
    setAiGenerating(true);
    try {
      const res = await genDesc({ data: { title, ideal, existing: description } });
      if (res.description) setDescription(res.description);
      toast.success(description.trim().length > 20 ? "Description enhanced!" : "Description generated!");
    } catch (e: any) { toast.error("Failed to generate: " + e.message); }
    finally { setAiGenerating(false); }
  }

  async function handleGenerateQs() {
    if (!title) { toast.error("Please enter a job title first"); return; }
    setAiGenerating(true);
    try {
      const res = await genQs({ data: { title, description, ideal, style: questionStyle as any, count: 3 } });
      if (res.questions && res.questions.length > 0) setQuestions(res.questions);
      toast.success("Questions generated!");
    } catch (e: any) { toast.error("Failed to generate: " + e.message); }
    finally { setAiGenerating(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Require a completed profile (name) before posting.
    const pSnap = await getDoc(doc(db, "profiles", user!.id));
    if (!pSnap.exists() || !((pSnap.data().full_name as string) || "").trim()) {
      toast.error("Complete your profile before posting a job."); navigate({ to: "/me/profile" }); return;
    }
    if (!company) { toast.error("Create a company first"); navigate({ to: "/recruiter/company" }); return; }
    setBusy(true);
    try {
      // Trust & safety screen. High-risk posts are held for review (and kept out of
      // the public feed); verified companies are trusted and always go live.
      const verified = company.verification_status === "verified";
      const mod = screenJobPost({ title, description, ideal });
      const held = !verified && mod.level === "block";
      const status = held ? "pending_review" : "active";

      // Poster first, then attached images. Feed cards render these.
      const mediaUrls = [poster, ...media].filter(Boolean);

      const docRef = await addDoc(collection(db, "jobs"), {
        company_id: company.id,
        created_by: user!.id,
        created_at: new Date().toISOString(),
        title,
        description,
        ideal_profile: ideal,
        location,
        employment_type: employmentType as "full_time",
        interview_mode: interviewMode,
        interview_focus: interviewFocus || null,
        salary_range: salary,
        questions: questions.filter((q) => q.trim()),
        rubric,
        status,
        media_urls: mediaUrls,
        video_url: videoUrl || null,
        og_image_url: poster || null,
        moderation: { risk: mod.risk, level: mod.level, flags: mod.flags },
      });
      const data = { id: docRef.id };

      if (held) {
        toast.warning("Your post was held for review — it triggered our spam filter. Verify your company to publish instantly.");
      } else {
        toast.success("Job posted!");
        // Only live jobs are shared to the feed.
        const tags = [employmentType, location].filter(Boolean).map((t) => t!.toString().toLowerCase().replace(/\s+/g, "-")).slice(0, 8);
        const postRef = await addDoc(collection(db, "posts"), {
          kind: "job",
          author_id: user!.id,
          company_id: company.id,
          job_id: data.id,
          created_at: new Date().toISOString(),
          title,
          body: description.slice(0, 600),
          media_urls: mediaUrls,
          video_url: videoUrl || null,
          tags,
        });
        // Notify everyone following this company.
        notifyFollowersFn({ data: { companyId: company.id, postId: postRef.id, title } }).catch(() => {});
      }
      // Auto-generate a poster only if the recruiter didn't make one.
      if (!poster) genOg({ data: { jobId: data.id } }).catch(() => {});
      // Embed the job, then alert matching applicants (needs the embedding first).
      embed({ data: { jobId: data.id } })
        .then(() => { if (!held) return notifyMatchesFn({ data: { jobId: data.id } }); })
        .catch(() => {});
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      navigate({ to: "/recruiter/jobs/$jobId", params: { jobId: data.id } });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">Post a job</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your AI interview will use these questions and the rubric to score each candidate.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="glass-strong rounded-3xl p-7 space-y-4">
            <Field label="Job title"><input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Senior Product Designer" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder="Remote · NYC" /></Field>
              <Field label="Employment type">
                <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className="input">
                  <option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option>
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Salary range (optional)"><input value={salary} onChange={(e) => setSalary(e.target.value)} className="input" placeholder="$100k–$140k" /></Field>
              <Field label="Interview mode">
                <select value={interviewMode} onChange={(e) => setInterviewMode(e.target.value)} className="input">
                  <option value="async">Async (Recorded)</option>
                  <option value="live">Live (Real-time AI)</option>
                </select>
              </Field>
            </div>
            {interviewMode === "live" && (
              <Field label="Live interview focus (optional)"><input value={interviewFocus} onChange={(e) => setInterviewFocus(e.target.value)} className="input" placeholder="e.g. system-design depth, communication, real ownership" /></Field>
            )}
            <Field label="Ideal candidate profile (optional)"><textarea value={ideal} onChange={(e) => setIdeal(e.target.value)} rows={3} className="input resize-none" placeholder="Skills, experience, qualities your perfect hire has." /></Field>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</span>
                <button type="button" onClick={handleGenerateDesc} disabled={aiGenerating} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50">{aiGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : "✨"} Generate with AI</button>
              </div>
              <textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className="input resize-none" placeholder="The role, what you'll do, what we offer…" />
            </div>
          </div>

          <div className="glass-strong rounded-3xl p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold">Phase 1 — screening questions</h2>
                <p className="mt-1 text-xs text-muted-foreground">Applicants answer these when they apply. The AI scores them with the resume. Re-generating <span className="font-medium">replaces</span> the list.</p>
              </div>
              <div className="flex items-center gap-2">
                <select value={questionStyle} onChange={(e) => setQuestionStyle(e.target.value)} className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs" title="Question style">
                  <option value="balanced">Balanced</option>
                  <option value="skill">Skill</option>
                  <option value="creativity">Creativity</option>
                  <option value="educational">Educational</option>
                  <option value="out_of_box">Out-of-box</option>
                </select>
                <button type="button" onClick={handleGenerateQs} disabled={aiGenerating} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline disabled:opacity-50">{aiGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : "✨"} Generate 3</button>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <input value={q} onChange={(e) => setQuestions(questions.map((x, j) => j === i ? e.target.value : x))} className="input" placeholder={`Question ${i + 1}`} />
                  <button type="button" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} className="glass rounded-2xl px-3 hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setQuestions([...questions, ""])} className="glass inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm hover:bg-secondary/60"><Plus className="h-4 w-4" /> Add question</button>
            </div>
          </div>

          <div className="glass-strong rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Media & poster</h2>
            <p className="mt-1 text-xs text-muted-foreground">Add images, a short promo video, or generate an AI poster. These show on your feed post.</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <label className="glass inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm hover:bg-secondary/60">
                <ImagePlus className="h-4 w-4" /> {uploadingMedia ? "Uploading…" : "Add images"}
                <input type="file" accept="image/*" multiple className="hidden" disabled={uploadingMedia} onChange={(e) => e.target.files?.length && addImages(e.target.files)} />
              </label>
              <label className="glass inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm hover:bg-secondary/60">
                <Video className="h-4 w-4" /> {videoUrl ? "Replace video" : "Add video"}
                <input type="file" accept="video/*" className="hidden" disabled={uploadingMedia} onChange={(e) => e.target.files?.[0] && addVideo(e.target.files[0])} />
              </label>
              <button type="button" onClick={generatePoster} disabled={genningPoster} className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/70 disabled:opacity-60">
                {genningPoster ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Quick AI poster
              </button>
              <button type="button" onClick={() => setShowBrand((v) => !v)} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Sparkles className="h-4 w-4" /> On-brand poster
              </button>
            </div>

            {showBrand && (
              <div className="mt-4 rounded-2xl border border-border bg-background/50 p-5">
                <p className="text-xs text-muted-foreground">Uses your <b>company brand theme</b> as the guide. Set it up in <span className="underline">Company settings → Brand theme</span> for best results. A small Crux mark is added to a corner.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {([
                    ["targetAge", "Target age group", "e.g. 22–30"],
                    ["feel", "Creative feel", "e.g. energetic, premium"],
                    ["inspiredFrom", "Inspired from", "e.g. Apple keynote posters"],
                    ["graphicStyles", "Graphic styles", "e.g. bold type, gradients"],
                    ["productInFocus", "Product in focus", "e.g. the role / the team"],
                  ] as const).map(([k, label, ph]) => (
                    <label key={k}>
                      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
                      <input value={(brandPoster as any)[k]} onChange={(e) => setBrandPoster((p) => ({ ...p, [k]: e.target.value }))} placeholder={ph} className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-foreground/30" />
                    </label>
                  ))}
                </div>
                <button type="button" onClick={generateOnBrandPoster} disabled={genBrand} className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
                  {genBrand ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {genBrand ? "Generating… (~15s)" : "Generate on-brand poster (4:3)"}
                </button>
              </div>
            )}

            {(poster || media.length > 0 || videoUrl) && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {poster && (
                  <div className="relative">
                    <img src={poster} alt="AI poster" className="aspect-video w-full rounded-2xl object-cover" />
                    <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">AI poster</span>
                    <button type="button" onClick={() => setPoster("")} className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"><X className="h-3 w-3" /></button>
                  </div>
                )}
                {media.map((u, i) => (
                  <div key={u} className="relative">
                    <img src={u} alt="" className="aspect-video w-full rounded-2xl object-cover" />
                    <button type="button" onClick={() => setMedia((m) => m.filter((_, j) => j !== i))} className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"><X className="h-3 w-3" /></button>
                  </div>
                ))}
                {videoUrl && (
                  <div className="relative">
                    <video src={videoUrl} className="aspect-video w-full rounded-2xl object-cover" muted />
                    <button type="button" onClick={() => setVideoUrl("")} className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"><X className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="glass-strong rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Scoring rubric</h2>
            <p className="mt-1 text-xs text-muted-foreground">Weights total 100. We'll normalize if they don't.</p>
            <div className="mt-4 space-y-3">
              {(Object.keys(rubric) as (keyof Rubric)[]).map((k) => (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-xs"><span className="capitalize text-foreground">{k.replace("_", " ")}</span><span className="text-muted-foreground">{rubric[k]}%</span></div>
                  <input type="range" min={0} max={100} value={rubric[k]} onChange={(e) => setRubric({ ...rubric, [k]: Number(e.target.value) })} className="w-full" />
                </div>
              ))}
            </div>
          </div>

          <button disabled={busy} className="w-full rounded-2xl bg-primary px-4 py-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? "Posting…" : "Post job"}
          </button>
        </form>
        <style>{`.input { width:100%; border-radius: 1rem; border: 1px solid var(--color-border); background: oklch(1 0 0 / 0.6); padding: 0.7rem 1rem; font-size: 0.875rem; outline: none; } .input:focus { border-color: oklch(0.12 0 0 / 0.3); }`}</style>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}
