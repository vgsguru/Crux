import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { db, storage } from "@/integrations/firebase/client";
import { collection, query, where, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { startAsyncInterview, saveAsyncAnswer, finalizeAsyncInterview, transcribeAnswer } from "@/lib/async-interview.server";
import { saveIntroVideo } from "@/lib/applications.server";
import { ArrowLeft, Circle, Square, Check, CheckCircle2, Video } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/apply/$jobId/interview")({
  component: AsyncInterview,
});

function AsyncInterview() {
  const { jobId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const startFn = useServerFn(startAsyncInterview);
  const saveFn = useServerFn(saveAsyncAnswer);
  const finalizeFn = useServerFn(finalizeAsyncInterview);

  const [appId, setAppId] = useState<string | null>(null);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [done, setDone] = useState<boolean[]>([]);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finalized, setFinalized] = useState(false);

  // Compulsory 20–30s intro video (Phase 2 gate).
  const [introUrl, setIntroUrl] = useState<string | null>(null);
  const [introRec, setIntroRec] = useState(false);
  const [introElapsed, setIntroElapsed] = useState(0);
  const [introBusy, setIntroBusy] = useState(false);
  const introTimerRef = useRef<number | null>(null);
  const saveIntroFn = useServerFn(saveIntroVideo);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const appsQuery = query(collection(db, "applications"), where("job_id", "==", jobId), where("applicant_id", "==", user.id));
      const appsSnap = await getDocs(appsQuery);
      if (appsSnap.empty) { toast.error("Apply first"); navigate({ to: "/apply/$jobId", params: { jobId } }); return; }
      const appDoc = appsSnap.docs[0];
      setAppId(appDoc.id);
      setIntroUrl((appDoc.data() as any).intro_video_url ?? null);
      try {
        const res = await startFn({ data: { applicationId: appDoc.id } }) as { interviewId: string; questions: string[] };
        setInterviewId(res.interviewId);
        setQuestions(res.questions);
        setDone(new Array(res.questions.length).fill(false));
        setTranscripts(new Array(res.questions.length).fill(""));
      } catch (e) { toast.error(e instanceof Error ? e.message : "Could not start interview"); }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [user, jobId, startFn, navigate]);

  async function ensureStream() {
    if (streamRef.current) return streamRef.current;
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    streamRef.current = s;
    if (videoRef.current) videoRef.current.srcObject = s;
    return s;
  }

  // ── Intro video (compulsory, 20–30s) ──
  async function startIntroRec() {
    try {
      const s = await ensureStream();
      chunksRef.current = [];
      const rec = new MediaRecorder(s, { mimeType: "video/webm" });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start();
      recorderRef.current = rec;
      setIntroElapsed(0);
      setIntroRec(true);
      introTimerRef.current = window.setInterval(() => setIntroElapsed((e) => e + 1), 1000);
    } catch { toast.error("Camera/mic permission required"); }
  }

  async function stopIntroSave() {
    if (introTimerRef.current) { clearInterval(introTimerRef.current); introTimerRef.current = null; }
    if (!recorderRef.current || !appId || !user) return;
    const elapsed = introElapsed;
    setIntroBusy(true);
    try {
      const blob: Blob = await new Promise((resolve) => {
        const rec = recorderRef.current!;
        rec.onstop = () => resolve(new Blob(chunksRef.current, { type: "video/webm" }));
        rec.stop();
      });
      setIntroRec(false);
      if (elapsed < 18) { toast.error("Your intro must be at least ~20 seconds"); setIntroBusy(false); return; }
      const path = `${user.id}/${appId}/intro-${Date.now()}.webm`;
      const sref = ref(storage, `interview-videos/${path}`);
      await uploadBytes(sref, blob, { contentType: "video/webm" });
      const url = await getDownloadURL(sref);
      await saveIntroFn({ data: { applicationId: appId, url } });
      setIntroUrl(url);
      toast.success("Intro saved — let's begin");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to save intro"); }
    finally { setIntroBusy(false); }
  }

  // Auto-stop the intro at 30 seconds.
  useEffect(() => {
    if (introRec && introElapsed >= 30) stopIntroSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introElapsed, introRec]);

  async function startRec() {
    try {
      const s = await ensureStream();
      chunksRef.current = [];
      const rec = new MediaRecorder(s, { mimeType: "video/webm" });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) { toast.error("Camera/mic permission required"); }
  }

  async function stopRec(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = recorderRef.current!;
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: "video/webm" }));
      rec.stop();
      setRecording(false);
    });
  }

  const transcribeFn = useServerFn(transcribeAnswer);
  async function transcribeBlob(blob: Blob): Promise<string> {
    try {
      const buf = await blob.arrayBuffer();
      let binary = ""; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const res = await transcribeFn({ data: { interviewId: interviewId!, audioBase64: btoa(binary), mime: "video/webm" } }) as { transcript?: string };
      return res.transcript ?? "";
    } catch { return ""; }
  }

  async function saveCurrent() {
    if (!interviewId || !appId || !user) return;
    setBusy(true);
    try {
      const blob = await stopRec();
      const path = `${user.id}/${appId}/q${index}-${Date.now()}.webm`;
      const storageRef = ref(storage, `interview-videos/${path}`);
      await uploadBytes(storageRef, blob, { contentType: "video/webm" });
      toast("Transcribing answer…");
      const transcript = await transcribeBlob(blob);
      await saveFn({ data: { interviewId, index, videoPath: path, transcript } });
      const nextDone = [...done]; nextDone[index] = true; setDone(nextDone);
      const nextT = [...transcripts]; nextT[index] = transcript; setTranscripts(nextT);
      toast.success("Answer saved");
      if (index < questions.length - 1) setIndex(index + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  async function finalize() {
    if (!interviewId) return;
    setBusy(true);
    try {
      const res = await finalizeFn({ data: { interviewId } }) as { total: number };
      setFinalized(true);
      toast.success(`Scored ${res.total.toFixed(0)}/100`);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      navigate({ to: "/me/applications/$applicationId", params: { applicationId: appId! } });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not finalize"); }
    finally { setBusy(false); }
  }

  const allDone = done.length > 0 && done.every(Boolean);

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/me/applications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Async video interview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Record one short answer per question. You can re-record before saving.</p>

        {/* Step 1 — compulsory intro video */}
        {!introUrl && (
          <div className="glass-strong mt-6 rounded-3xl p-7">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Step 1 · Required</p>
            <h2 className="mt-1 font-display text-xl font-semibold">Record a 20–30s intro</h2>
            <p className="mt-1 text-sm text-muted-foreground">Tell us briefly who you are and why this role. This is required before the questions.</p>
            <div className="mt-5 overflow-hidden rounded-2xl bg-black aspect-video relative">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {introRec && <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">{introElapsed}s {introElapsed < 20 ? "· keep going" : "· you can stop"}</span>}
            </div>
            <div className="mt-5">
              {!introRec ? (
                <button onClick={startIntroRec} disabled={introBusy} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"><Video className="h-4 w-4" /> {introBusy ? "Saving…" : "Start intro"}</button>
              ) : (
                <button onClick={stopIntroSave} disabled={introBusy || introElapsed < 3} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-50"><Square className="h-4 w-4" /> {introBusy ? "Saving…" : "Stop & save"}</button>
              )}
            </div>
          </div>
        )}

        {introUrl && questions.length === 0 && <div className="glass mt-6 rounded-3xl p-10 text-center text-sm text-muted-foreground">Loading questions…</div>}

        {introUrl && questions.length > 0 && (
          <>
            <div className="mt-6 flex flex-wrap gap-1.5">
              {questions.map((_, i) => (
                <button key={i} onClick={() => !recording && setIndex(i)} className={`grid h-8 w-8 place-items-center rounded-full text-xs font-medium ${i === index ? "bg-primary text-primary-foreground" : done[i] ? "bg-foreground/80 text-background" : "bg-secondary"}`}>{done[i] ? <Check className="h-3.5 w-3.5" /> : i + 1}</button>
              ))}
            </div>

            <div className="glass-strong mt-6 rounded-3xl p-7">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Question {index + 1} of {questions.length}</p>
              <h2 className="mt-1 font-display text-xl font-semibold">{questions[index]}</h2>
              <div className="mt-5 overflow-hidden rounded-2xl bg-black aspect-video">
                <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              </div>
              <div className="mt-5 flex flex-wrap justify-between gap-2">
                {!recording ? (
                  <button onClick={startRec} disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"><Circle className="h-4 w-4 fill-red-500 text-red-500" /> {done[index] ? "Re-record" : "Start recording"}</button>
                ) : (
                  <button onClick={saveCurrent} disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-50"><Square className="h-4 w-4" /> {busy ? "Saving…" : "Stop & save"}</button>
                )}
                {transcripts[index] && !recording && (
                  <p className="max-w-md truncate text-xs text-muted-foreground">"{transcripts[index].slice(0, 120)}…"</p>
                )}
              </div>
            </div>

            {allDone && (
              <div className="glass mt-6 flex items-center justify-between rounded-3xl p-6">
                <div>
                  <p className="font-display text-base font-semibold">All answers recorded</p>
                  <p className="mt-1 text-xs text-muted-foreground">Submit to generate your transcript and score.</p>
                </div>
                <button onClick={finalize} disabled={busy || finalized} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> {busy ? "Scoring…" : "Submit interview"}</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
