import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { startInterview, interviewFollowup, finishInterview } from "@/lib/ai.server";
import { Mic, MicOff, Loader2, Send, Volume2, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Turn = { q: string; a: string };
type Phase = "loading" | "intro" | "asking" | "answering" | "thinking" | "done";

const MAX_FOLLOWUPS = 2; // per planned question — keeps the interview bounded

// 100% free: browser SpeechSynthesis (AI voice) + SpeechRecognition (live transcript) + Groq (brain).
export function LiveInterview({ applicationId, jobId, onComplete }: { applicationId: string; jobId: string; onComplete: (applicationId: string) => void }) {
  const startFn = useServerFn(startInterview);
  const followupFn = useServerFn(interviewFollowup);
  const finishFn = useServerFn(finishInterview);

  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<string[]>([]);
  const [focus, setFocus] = useState("");
  const [planIndex, setPlanIndex] = useState(0);
  const [currentQ, setCurrentQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [listening, setListening] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const [speaking, setSpeaking] = useState(false);

  const interviewIdRef = useRef<string>("");
  const transcriptRef = useRef<Turn[]>([]);
  const followupsRef = useRef(0);
  const planIndexRef = useRef(0);
  const planRef = useRef<string[]>([]);
  const focusRef = useRef("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recogRef = useRef<any>(null);
  const finalRef = useRef("");
  const tabSwitchRef = useRef(0);
  const srSupported = typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Start the interview (fetch the plan) but don't speak until the candidate clicks Begin (TTS needs a gesture).
  useEffect(() => {
    (async () => {
      try {
        const res: any = await startFn({ data: { applicationId } });
        planRef.current = res.questions ?? [];
        focusRef.current = res.focus ?? "";
        setPlan(res.questions ?? []);
        setFocus(res.focus ?? "");
        interviewIdRef.current = res.interviewId;
        setPhase("intro");
      } catch (e: any) {
        toast.error(e?.message ?? "Could not start interview");
      }
    })();
    const onHide = () => { if (document.hidden) tabSwitchRef.current++; };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try { window.speechSynthesis?.cancel(); recogRef.current?.stop(); } catch { /* */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function speak(text: string, onEnd: () => void) {
    setSpeaking(true);
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1;
      let done = false;
      const finish = () => { if (done) return; done = true; setSpeaking(false); onEnd(); };
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
      // Fallback in case onend never fires (some browsers): advance after a length-based timeout.
      setTimeout(finish, Math.min(2500 + text.length * 60, 15000));
    } catch { setSpeaking(false); onEnd(); }
  }

  async function ensureStream() {
    if (streamRef.current) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { /* camera optional; interview still works */ }
  }

  function ask(q: string) {
    setCurrentQ(q);
    setAnswer("");
    finalRef.current = "";
    setPhase("asking");
    speak(q, () => setPhase("answering"));
  }

  async function begin() {
    await ensureStream();
    planIndexRef.current = 0;
    ask(planRef.current[0] ?? "Tell me about yourself and why this role.");
  }

  function startRecognition() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += t + " ";
        else interim += t;
      }
      setAnswer((finalRef.current + interim).trim());
    };
    r.onend = () => { if (listening) { try { r.start(); } catch { /* */ } } };
    try { r.start(); recogRef.current = r; setListening(true); } catch { /* */ }
  }
  function stopRecognition() {
    setListening(false);
    try { recogRef.current?.stop(); } catch { /* */ }
    recogRef.current = null;
  }

  async function submitAnswer() {
    if (!answer.trim()) { toast.error("Give an answer first (speak or type)"); return; }
    stopRecognition();
    const turn: Turn = { q: currentQ, a: answer.trim() };
    transcriptRef.current = [...transcriptRef.current, turn];
    setHistory(transcriptRef.current);
    setPhase("thinking");

    const allow = followupsRef.current < MAX_FOLLOWUPS;
    let followup: string | null = null;
    try {
      const res: any = await followupFn({ data: { jobId, focus: focusRef.current, question: currentQ, answer: turn.a, allowFollowup: allow } });
      followup = res?.followup ?? null;
    } catch { followup = null; }

    if (followup) {
      followupsRef.current += 1;
      ask(followup);
    } else {
      followupsRef.current = 0;
      planIndexRef.current += 1;
      setPlanIndex(planIndexRef.current);
      if (planIndexRef.current < planRef.current.length) {
        ask(planRef.current[planIndexRef.current]);
      } else {
        await finalize();
      }
    }
  }

  async function finalize() {
    setPhase("done");
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      await finishFn({ data: {
        interviewId: interviewIdRef.current,
        transcript: transcriptRef.current,
        flags: tabSwitchRef.current > 0 ? [`tab switched ${tabSwitchRef.current}x`] : [],
      } });
      toast.success("Interview complete — generating your report");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not finalize");
    }
    onComplete(applicationId);
  }

  const totalSteps = plan.length || 1;

  if (phase === "loading") {
    return <div className="glass-strong rounded-3xl p-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" /> Preparing your interview…</div>;
  }

  if (phase === "intro") {
    return (
      <div className="glass-strong rounded-3xl p-8 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-3 font-display text-2xl font-bold">Live AI interview</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The AI will ask you {plan.length} question{plan.length === 1 ? "" : "s"} by voice and may ask follow-ups based on your answers.
          {focus ? <> Focus: <span className="font-medium text-foreground">{focus}</span>.</> : null} Speak naturally — you'll see a live transcript you can edit before sending.
        </p>
        {!srSupported && <p className="mx-auto mt-3 max-w-md text-xs text-amber-600">Voice input isn't supported in this browser — you can type your answers instead (Chrome recommended for speech).</p>}
        <button onClick={begin} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Volume2 className="h-4 w-4" /> Begin interview
        </button>
        <p className="mt-3 text-xs text-muted-foreground">Make sure your sound is on. Camera is used for presence only.</p>
      </div>
    );
  }

  if (phase === "done") {
    return <div className="glass-strong rounded-3xl p-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-primary" /><h2 className="mt-3 font-display text-xl font-semibold">Interview complete</h2><p className="mt-1 text-sm text-muted-foreground">Scoring your answers and writing your feedback…</p><Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin" /></div>;
  }

  // asking / answering / thinking
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Question {Math.min(planIndex + 1, totalSteps)} of {totalSteps}{followupsRef.current > 0 ? " · follow-up" : ""}</span>
        <span className="flex gap-1">{plan.map((_, i) => <span key={i} className={`h-1.5 w-6 rounded-full ${i < planIndex ? "bg-primary" : i === planIndex ? "bg-primary/50" : "bg-secondary"}`} />)}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="glass-strong rounded-3xl p-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
            <Volume2 className={`h-4 w-4 ${speaking ? "animate-pulse" : ""}`} /> Interviewer
          </div>
          <p className="mt-2 font-display text-xl font-semibold">{currentQ}</p>

          {phase === "thinking" ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Considering your answer…</div>
          ) : phase === "asking" ? (
            <div className="mt-5 text-sm text-muted-foreground">Listen to the question…</div>
          ) : (
            <div className="mt-4">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={5}
                placeholder={srSupported ? "Speak your answer — it appears here. You can also type/edit." : "Type your answer…"}
                className="w-full resize-none rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm outline-none focus:border-foreground/30"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {srSupported && (
                  listening ? (
                    <button onClick={stopRecognition} className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600"><MicOff className="h-4 w-4" /> Stop mic</button>
                  ) : (
                    <button onClick={startRecognition} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/70"><Mic className="h-4 w-4" /> Speak</button>
                  )
                )}
                <button onClick={submitAnswer} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"><Send className="h-4 w-4" /> Send answer</button>
                {listening && <span className="inline-flex items-center gap-1 text-xs text-red-600"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> listening</span>}
              </div>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-3xl bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="h-full min-h-[140px] w-full object-cover" />
        </div>
      </div>

      {history.length > 0 && (
        <details className="glass rounded-2xl p-4 text-sm">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground">Conversation so far ({history.length})</summary>
          <div className="mt-3 space-y-3">
            {history.map((t, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-foreground/70">Q: {t.q}</p>
                <p className="mt-0.5 text-sm text-foreground/90">{t.a}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
