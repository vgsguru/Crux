import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { db, storage } from "@/integrations/firebase/client";
import { collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc, query, where } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { parseResume, transcribeIntro, startInterview } from "@/lib/ai.server";
import { embedMyProfile } from "@/lib/match.server";
import { submitApplication } from "@/lib/applications.server";
import { extractPdfText } from "@/lib/pdf-text";
import { toast } from "sonner";
import { Upload, Video, Camera, CheckCircle2, ArrowRight, Square, Circle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/apply/$jobId")({
  component: ApplyWizard,
});

type Step = "resume" | "submit";

async function fileToBase64(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function ApplyWizard() {
  const { jobId } = Route.useParams();
  const { user, isRecruiter, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Recruiters can't apply — bounce them out.
  useEffect(() => {
    if (!authLoading && isRecruiter) {
      toast.error("Recruiter accounts can't apply to jobs.");
      navigate({ to: "/jobs" });
    }
  }, [authLoading, isRecruiter, navigate]);

  // Require a completed profile (name) before applying.
  useEffect(() => {
    if (authLoading || !user || isRecruiter) return;
    (async () => {
      const snap = await getDoc(doc(db, "profiles", user.id));
      const name = snap.exists() ? (snap.data().full_name as string) : "";
      if (!name || !name.trim()) {
        toast.error("Complete your profile before applying.");
        navigate({ to: "/me/profile" });
      }
    })();
  }, [authLoading, user, isRecruiter, navigate]);
  const parseFn = useServerFn(parseResume);
  const transcribeFn = useServerFn(transcribeIntro);
  const startFn = useServerFn(startInterview);
  const embedFn = useServerFn(embedMyProfile);

  const [step, setStep] = useState<Step>("resume");
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Async jobs use the recorded-answer flow; live jobs use the real-time AI interview.
  const { data: interviewMode } = useQuery({
    queryKey: ["job-interview-mode", jobId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "jobs", jobId));
      return (snap.exists() ? (snap.data().interview_mode as string) : "live") || "live";
    },
  });

  // Load any existing application to resume it. We do NOT create one here — only
  // when the candidate actually uploads a resume — so merely visiting this page
  // never makes it look like they applied.
  useEffect(() => {
    if (!user || isRecruiter) return;
    (async () => {
      const appsQuery = query(collection(db, "applications"), where("job_id", "==", jobId), where("applicant_id", "==", user.id));
      const appsSnap = await getDocs(appsQuery);
      if (!appsSnap.empty) {
        const existingDoc = appsSnap.docs[0];
        const existing = { id: existingDoc.id, ...existingDoc.data() } as any;
        // Already submitted → it lives in My Applications now, not a draft to continue.
        if (existing.status && existing.status !== "draft") { navigate({ to: "/me/applications" }); return; }
        setApplicationId(existing.id);
        if (existing.resume_url) setStep("submit");
      }
    })();
  }, [user, jobId, isRecruiter]);

  // Creates the draft application on first real action (resume upload).
  async function ensureApplicationId(): Promise<string> {
    if (applicationId) return applicationId;
    // Default to applicant role if the user has none yet (never clobber existing).
    const userRef = doc(db, "users", user!.id);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists() || !userSnap.data()?.role) {
      await setDoc(userRef, { role: "applicant" }, { merge: true });
    }
    const ref = await addDoc(collection(db, "applications"), {
      job_id: jobId,
      applicant_id: user!.id,
      status: "draft",
      pipeline_status: "draft",
      created_at: new Date().toISOString(),
    });
    setApplicationId(ref.id);
    return ref.id;
  }

  // Wait for auth to resolve before rendering steps (they need user.id).
  if (authLoading || !user) {
    return (
      <div className="bg-ambient min-h-screen">
        <SiteNav />
        <div className="mx-auto max-w-2xl px-4 py-20 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">Apply</h1>
        <p className="mt-2 text-sm text-muted-foreground">Submit your resume and a relevant project. If the recruiter shortlists you, you'll be invited to the AI interview — no live test up front.</p>

        <div className="my-6 flex gap-2">
          {(["resume", "submit"] as Step[]).map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${["resume", "submit"].indexOf(step) >= i ? "bg-primary" : "bg-secondary"}`} />
          ))}
        </div>

        {step === "resume" && (
          <ResumeStep ensureApplicationId={ensureApplicationId} parseFn={parseFn} embedFn={embedFn} onDone={() => setStep("submit")} busy={busy} setBusy={setBusy} userId={user.id} />
        )}
        {step === "submit" && applicationId && (
          <SubmitStep applicationId={applicationId} jobId={jobId} userId={user.id} onSubmitted={() => navigate({ to: "/me/applications" })} />
        )}
      </main>
    </div>
  );
}

function ResumeStep({ ensureApplicationId, parseFn, embedFn, onDone, userId, busy, setBusy }: { ensureApplicationId: () => Promise<string>; parseFn: ReturnType<typeof useServerFn<typeof parseResume>>; embedFn: ReturnType<typeof useServerFn<typeof embedMyProfile>>; onDone: () => void; userId: string; busy: boolean; setBusy: (b: boolean) => void }) {
  async function handle(file: File) {
    if (file.size > 10 * 1024 * 1024) { toast.error("Resume must be under 10 MB"); return; }
    setBusy(true);
    try {
      const applicationId = await ensureApplicationId();
      const path = `${userId}/${applicationId}-${Date.now()}-${file.name}`;
      const storageRef = ref(storage, `resumes/${path}`);
      toast("Reading resume…");
      const text = await extractPdfText(file);
      if (!text || text.length < 30) throw new Error("Couldn't read text from this PDF — is it a scanned image?");
      toast("Uploading resume…");
      await uploadBytes(storageRef, file, { contentType: file.type || "application/pdf" });
      const signedUrl = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "applications", applicationId), { resume_url: signedUrl });
      toast("Parsing resume…");
      const res = await parseFn({ data: { applicationId, resumeText: text } });
      const resumeText = (res as { resumeText?: string } | undefined)?.resumeText;
      if (resumeText && embedFn) embedFn({ data: { resumeText } }).catch(() => {});
      toast.success("Resume saved");
      onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally { setBusy(false); }
  }
  return (
    <div className="glass-strong rounded-3xl p-8 text-center">
      <Upload className="mx-auto h-8 w-8" />
      <h2 className="mt-3 font-display text-xl font-semibold">Upload your resume</h2>
      <p className="mt-1 text-sm text-muted-foreground">PDF · up to 10 MB. We'll extract the key info.</p>
      <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
        {busy ? "Working…" : "Choose PDF"}
        <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} disabled={busy} />
      </label>
    </div>
  );
}

function SubmitStep({ applicationId, jobId, userId, onSubmitted }: { applicationId: string; jobId: string; userId: string; onSubmitted: () => void }) {
  const submitFn = useServerFn(submitApplication);
  const [projectId, setProjectId] = useState("");
  const [projectLink, setProjectLink] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<any>(null);

  const { data: posts } = useQuery({
    queryKey: ["my-showcase-posts", userId],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "posts"), where("author_id", "==", userId), where("kind", "==", "showcase")));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);
    },
  });

  // Phase-1 screening questions set by the recruiter.
  const { data: questions } = useQuery({
    queryKey: ["job-questions", jobId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "jobs", jobId));
      const qs = snap.exists() ? (snap.data().questions as string[]) : [];
      return (Array.isArray(qs) ? qs : []).filter(Boolean);
    },
  });

  async function submit() {
    if (questions && questions.length > 0) {
      const unanswered = questions.some((_, i) => !(answers[i] ?? "").trim());
      if (unanswered) { toast.error("Please answer all screening questions"); return; }
    }
    setSubmitting(true);
    try {
      const payload = (questions ?? []).map((q, i) => ({ q, a: (answers[i] ?? "").trim() }));
      const res: any = await submitFn({ data: { applicationId, projectPostId: projectId || null, projectLink: projectLink.trim() || null, answers: payload } });
      toast.success("Application submitted!");
      setReport(res?.report ?? {});
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to submit");
    } finally { setSubmitting(false); }
  }

  // After submit: show the applicant their AI report.
  if (report) {
    const list = (arr: any) => Array.isArray(arr) ? arr : [];
    return (
      <div className="glass-strong rounded-3xl p-8">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Your application report</h2>
          {report.overall_pct != null && (
            <div className="text-right"><div className="font-display text-3xl font-bold">{Math.round(report.overall_pct)}%</div><p className="text-xs text-muted-foreground">role match</p></div>
          )}
        </div>
        {report.summary && <p className="mt-3 text-sm text-foreground/80">{report.summary}</p>}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {list(report.matched_skills).length > 0 && (
            <div className="rounded-2xl bg-emerald-500/5 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">What's strong</p><ul className="mt-2 space-y-1 text-sm">{list(report.matched_skills).map((s: string, i: number) => <li key={i}>✓ {s}</li>)}</ul></div>
          )}
          {list(report.gaps).length > 0 && (
            <div className="rounded-2xl bg-amber-500/5 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-amber-600">What's missing</p><ul className="mt-2 space-y-1 text-sm">{list(report.gaps).map((s: string, i: number) => <li key={i}>• {s}</li>)}</ul></div>
          )}
          {list(report.skills_to_learn).length > 0 && (
            <div className="rounded-2xl bg-secondary/40 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Skills to learn</p><ul className="mt-2 space-y-1 text-sm">{list(report.skills_to_learn).map((s: string, i: number) => <li key={i}>→ {s}</li>)}</ul></div>
          )}
          {list(report.projects_to_build).length > 0 && (
            <div className="rounded-2xl bg-secondary/40 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Projects to build</p><ul className="mt-2 space-y-1 text-sm">{list(report.projects_to_build).map((s: string, i: number) => <li key={i}>→ {s}</li>)}</ul></div>
          )}
        </div>
        {report.answer_feedback && <p className="mt-4 rounded-2xl bg-secondary/30 p-4 text-sm text-foreground/75"><span className="font-medium">On your answers: </span>{report.answer_feedback}</p>}
        <button onClick={onSubmitted} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
          Go to my applications <ArrowRight className="h-4 w-4" />
        </button>
        <p className="mt-3 text-center text-xs text-muted-foreground">The recruiter received this report. You'll be notified if you're shortlisted for the interview round.</p>
      </div>
    );
  }

  return (
    <div className="glass-strong rounded-3xl p-8">
      <div className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> Resume uploaded & parsed</div>

      {questions && questions.length > 0 && (
        <div className="mt-5">
          <h2 className="font-display text-xl font-semibold">Screening questions</h2>
          <p className="mt-1 text-sm text-muted-foreground">Answer in a few sentences each — the AI scores these alongside your resume.</p>
          <div className="mt-4 space-y-4">
            {questions.map((q, i) => (
              <div key={i}>
                <label className="text-sm font-medium">{i + 1}. {q}</label>
                <textarea value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} rows={3} className="mt-1 w-full rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30 resize-none" placeholder="Your answer…" />
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="mt-6 font-display text-xl font-semibold">Attach a relevant project <span className="text-sm font-normal text-muted-foreground">(optional)</span></h2>
      <p className="mt-1 text-sm text-muted-foreground">Show work that's relevant to this role — it strengthens your application.</p>

      {posts && posts.length > 0 && (
        <div className="mt-4">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">From your showcase</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30">
            <option value="">None</option>
            {posts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      )}
      <div className="mt-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Or paste a link (GitHub, demo, case study)</label>
        <input value={projectLink} onChange={(e) => setProjectLink(e.target.value)} placeholder="https://github.com/…" className="mt-1 w-full rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30" />
      </div>

      <button disabled={submitting} onClick={submit} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {submitting ? "Analyzing…" : "Submit application"} <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-3 text-center text-xs text-muted-foreground">We'll AI-audit your resume + answers and show you a report. No live interview unless you're shortlisted.</p>
    </div>
  );
}

function VideoStep({ applicationId, transcribeFn, onDone, userId }: { applicationId: string; transcribeFn: ReturnType<typeof useServerFn<typeof transcribeIntro>>; onDone: () => void; userId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<Blob | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => {
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
    }).catch(() => toast.error("Camera/mic permission needed"));
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((e) => {
      if (e >= 60) { stop(); return 60; }
      return e + 1;
    }), 1000);
    return () => clearInterval(id);
  }, [recording]);

  function start() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    const r = new MediaRecorder(streamRef.current, { mimeType: mime });
    r.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    r.onstop = () => { setRecorded(new Blob(chunksRef.current, { type: mime })); setRecording(false); };
    r.start();
    recRef.current = r;
    setElapsed(0);
    setRecording(true);
  }
  function stop() { recRef.current?.state === "recording" && recRef.current.stop(); }

  async function submit() {
    if (!recorded) return;
    setBusy(true);
    try {
      const path = `${userId}/${applicationId}-${Date.now()}.webm`;
      const storageRef = ref(storage, `intro-videos/${path}`);
      await uploadBytes(storageRef, recorded, { contentType: recorded.type });
      const signedUrl = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "applications", applicationId), { intro_video_url: signedUrl });
      toast("Transcribing your pitch…");
      const b64 = await fileToBase64(recorded);
      await transcribeFn({ data: { applicationId, audioBase64: b64, mime: recorded.type } });
      toast.success("Pitch saved");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="glass-strong rounded-3xl p-7">
      <h2 className="font-display text-xl font-semibold">Record a 60-second pitch</h2>
      <p className="mt-1 text-sm text-muted-foreground">Why are you a fit for this role?</p>
      <div className="relative mt-5 overflow-hidden rounded-2xl bg-black aspect-video">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {recording && <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-destructive/90 px-3 py-1 text-xs font-semibold text-destructive-foreground"><Circle className="h-2 w-2 fill-current" /> REC {elapsed}s / 60</div>}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {!recorded && !recording && <button onClick={start} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"><Circle className="h-4 w-4" /> Start recording</button>}
        {recording && <button onClick={stop} className="inline-flex items-center gap-2 rounded-full bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground"><Square className="h-4 w-4" /> Stop</button>}
        {recorded && !recording && <>
          <button onClick={() => { setRecorded(null); setElapsed(0); }} className="glass rounded-full px-5 py-2.5 text-sm">Re-record</button>
          <button disabled={busy} onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Uploading…" : "Use this clip"} <ArrowRight className="h-4 w-4" /></button>
        </>}
      </div>
    </div>
  );
}

function DeviceStep({ onReady }: { onReady: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ok, setOk] = useState(false);
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => {
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
      setOk(true);
      // we keep stream for next step; user will move on
      return () => s.getTracks().forEach((t) => t.stop());
    }).catch(() => toast.error("Camera/mic permission needed"));
  }, []);
  return (
    <div className="glass-strong rounded-3xl p-7">
      <h2 className="font-display text-xl font-semibold">Device & consent check</h2>
      <p className="mt-1 text-sm text-muted-foreground">The interview is recorded so the recruiter can review your real answers — that's what makes it fairer than a keyword filter.</p>
      <div className="mt-5 overflow-hidden rounded-2xl bg-black aspect-video">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${ok ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"}`}><CheckCircle2 className="h-3.5 w-3.5" /> {ok ? "Camera & mic ready" : "Waiting for permission"}</div>
      </div>
      <div className="mt-5 rounded-2xl border border-border bg-background/40 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground/80">What we capture, and why</p>
        <ul className="mt-2 space-y-1">
          <li>• Your video answers and a transcript — shared only with this recruiter.</li>
          <li>• Periodic snapshots + tab-switch checks for integrity (so honest candidates aren't undercut by cheating).</li>
          <li>• We never infer age, gender, or background; scoring is on your answers only, with evidence you can see afterward.</li>
        </ul>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-foreground/80">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          <span>I consent to this recording and proctoring for this application.</span>
        </label>
      </div>
      <button disabled={!ok || !consent} onClick={onReady} className="mt-5 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-60">Continue</button>
    </div>
  );
}

function ReadyStep({ applicationId, startFn, onStart }: { applicationId: string; startFn: ReturnType<typeof useServerFn<typeof startInterview>>; onStart: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const res = await startFn({ data: { applicationId } });
      sessionStorage.setItem(`interview-${res.interviewId}-questions`, JSON.stringify(res.questions));
      onStart(res.interviewId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    } finally { setBusy(false); }
  }
  return (
    <div className="glass-strong rounded-3xl p-8 text-center">
      <Video className="mx-auto h-8 w-8" />
      <h2 className="mt-3 font-display text-2xl font-semibold">You're ready</h2>
      <p className="mt-2 text-sm text-muted-foreground">A series of personalized questions. Take your time — we score answers, not speed.</p>
      <button disabled={busy} onClick={go} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {busy ? "Preparing…" : "Start AI interview"} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function AsyncReadyStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="glass-strong rounded-3xl p-8 text-center">
      <Video className="mx-auto h-8 w-8" />
      <h2 className="mt-3 font-display text-2xl font-semibold">Record your answers</h2>
      <p className="mt-2 text-sm text-muted-foreground">This role uses an async interview — record short video answers on your own time. We transcribe and score each one.</p>
      <button onClick={onStart} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
        Start recording <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
