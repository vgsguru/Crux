import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { storage } from "@/integrations/firebase/client";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/hooks/use-auth";
import { finishInterview, generateSpeech } from "@/lib/ai.server";
import { toast } from "sonner";
import { Sparkles, Mic, MicOff, ArrowRight, Loader2, AlertTriangle, Volume2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/interview/$interviewId")({
  component: InterviewRoom,
});

type QA = { q: string; a: string };
type Flag = { kind: string; t: number };

function InterviewRoom() {
  const { interviewId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const finishFn = useServerFn(finishInterview);
  const speechFn = useServerFn(generateSpeech);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  const [questions, setQuestions] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [transcript, setTranscript] = useState<QA[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [phase, setPhase] = useState<"loading" | "speaking" | "listening" | "review" | "finishing" | "done">("loading");
  const [listening, setListening] = useState(false);
  const [isTtsSpeaking, setIsTtsSpeaking] = useState(false);
  const recognitionRef = useRef<{ stop?: () => void } | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  // Setup
  useEffect(() => {
    const saved = sessionStorage.getItem(`interview-${interviewId}-questions`);
    if (saved) setQuestions(JSON.parse(saved));
    else {
      setQuestions(["Tell us briefly about yourself and why this role interests you."]);
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => {
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const r = new MediaRecorder(s, { mimeType: mime });
      r.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      r.start(1000);
      recRef.current = r;
      setPhase("speaking");
    }).catch(() => toast.error("Camera and mic permission needed"));
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.stop?.();
    };
  }, [interviewId]);

  // Proctoring: tab-switch / window blur / fullscreen exit
  useEffect(() => {
    if (phase === "loading" || phase === "done") return;
    const pushFlag = (kind: string) => {
      const t = Math.round((Date.now() - startedAtRef.current) / 1000);
      setFlags((f) => [...f, { kind, t }]);
      toast.warning(`Integrity flag: ${kind}`);
    };
    const onVis = () => { if (document.hidden) pushFlag("tab_hidden"); };
    const onBlur = () => pushFlag("window_blur");
    const onCopy = () => pushFlag("copy_attempt");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
    };
  }, [phase]);

  // Snapshot loop
  useEffect(() => {
    if (phase === "loading" || phase === "done") return;
    const id = setInterval(() => {
      if (!videoRef.current || !canvasRef.current || !streamRef.current) return;
      const c = canvasRef.current;
      c.width = 320; c.height = 180;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoRef.current, 0, 0, c.width, c.height);
      setSnapshots((s) => [...s, c.toDataURL("image/jpeg", 0.6)]);
    }, 30000);
    return () => clearInterval(id);
  }, [phase]);

  // Speak current question
  async function speakQuestion(text: string) {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    setIsTtsSpeaking(true);
    try {
      const res = await speechFn({ data: { text } }) as { audioBase64: string; mime?: string };
      // No TTS configured (or it returned nothing): show the question text and listen.
      if (!res.audioBase64) {
        setIsTtsSpeaking(false);
        setPhase("listening");
        startListening();
        return;
      }
      const audio = new Audio(`data:${res.mime ?? "audio/mpeg"};base64,${res.audioBase64}`);
      audioRef.current = audio;
      
      audio.onended = () => {
        setIsTtsSpeaking(false);
        setPhase("listening");
        startListening();
      };
      
      audio.onerror = () => {
        console.error("Audio playback error");
        setIsTtsSpeaking(false);
        setPhase("listening");
        startListening();
      };
      
      await audio.play();
    } catch (err) {
      console.error("TTS failed:", err);
      // Fallback to text only
      setIsTtsSpeaking(false);
      setPhase("listening");
      startListening();
    }
  }

  useEffect(() => {
    if (phase !== "speaking" || !questions[idx]) return;
    speakQuestion(questions[idx]);
  }, [phase, idx, questions]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptScrollRef.current?.scrollTo({ top: transcriptScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, currentAnswer]);

  function startListening() {
    setCurrentAnswer("");
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) { setListening(true); return; }
    const r = new (SR as unknown as new () => { continuous: boolean; interimResults: boolean; lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void; onend: () => void; start: () => void; stop: () => void })();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setCurrentAnswer(txt);
    };
    r.onerror = () => {};
    r.onend = () => setListening(false);
    r.start();
    recognitionRef.current = r;
    setListening(true);
  }
  function stopListening() {
    recognitionRef.current?.stop?.();
    setListening(false);
  }

  function nextQuestion() {
    const newT = [...transcript, { q: questions[idx], a: currentAnswer.trim() }];
    setTranscript(newT);
    setCurrentAnswer("");
    if (idx + 1 >= questions.length) {
      void finish(newT);
    } else {
      setIdx(idx + 1);
      setPhase("speaking");
    }
  }

  async function finish(finalTranscript: QA[]) {
    setPhase("finishing");
    try {
      recRef.current?.stop();
      await new Promise((r) => setTimeout(r, 500));
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const path = `${user!.id}/${interviewId}-${Date.now()}.webm`;
      const storageRef = ref(storage, `interview-videos/${path}`);
      let videoUrl: string | undefined;
      try {
        await uploadBytes(storageRef, blob, { contentType: blob.type });
        videoUrl = await getDownloadURL(storageRef);
      } catch (upErr) {
        console.error("Upload failed", upErr);
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());

      const res = await finishFn({ data: { interviewId, transcript: finalTranscript, snapshots, flags: flags.map((f) => `${f.kind}@${f.t}s`), videoUrl } });
      toast.success(`Scored: ${res.score?.toFixed(0)}/100`);
      setPhase("done");
      setTimeout(() => navigate({ to: "/me/applications" }), 1500);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to finish");
      setPhase("review");
    }
  }

  return (
    <div className="bg-ambient min-h-screen">
      <main className="mx-auto grid min-h-screen max-w-6xl grid-rows-[auto_1fr] gap-4 p-4">
        <div className="glass flex items-center justify-between rounded-full px-5 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" /> Live AI interview
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {flags.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
                <AlertTriangle className="h-3 w-3" /> {flags.length}
              </span>
            )}
            <span>Question {Math.min(idx + 1, questions.length || 1)} / {questions.length || "…"}</span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="grid gap-4">
            <div className="glass-strong relative overflow-hidden rounded-3xl">
              <div className="aspect-video bg-black">
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
                {isTtsSpeaking && (
                  <div className="absolute inset-0 bg-primary/10 animate-pulse pointer-events-none" />
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <div className="glass-dark flex flex-col gap-2 rounded-2xl p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-xs uppercase tracking-wider opacity-70">AI Interviewer</p>
                      {isTtsSpeaking && <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary uppercase tracking-wider"><span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" /> Speaking</span>}
                    </div>
                    {phase !== "loading" && !isTtsSpeaking && (
                      <button onClick={() => speakQuestion(questions[idx])} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Replay question" title="Replay question">
                        <Volume2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <p className="font-display text-lg font-medium">{phase === "loading" ? "Preparing…" : questions[idx]}</p>
                </div>
              </div>
            </div>

            {/* Live transcript history */}
            <div className="glass rounded-3xl p-5">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Conversation</h3>
              <div ref={transcriptScrollRef} className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-2">
                {transcript.length === 0 && currentAnswer === "" && (
                  <p className="text-xs text-muted-foreground">Your back-and-forth will appear here as you go.</p>
                )}
                {transcript.map((t, i) => (
                  <div key={i} className="space-y-1.5">
                    <p className="text-xs"><span className="font-semibold uppercase tracking-wider text-muted-foreground">AI</span> · {t.q}</p>
                    <p className="text-xs text-foreground/80 pl-2 border-l border-border"><span className="font-semibold uppercase tracking-wider text-muted-foreground">You</span> · {t.a || <em className="opacity-50">(no answer)</em>}</p>
                  </div>
                ))}
                {currentAnswer && (
                  <div className="space-y-1.5 opacity-70">
                    <p className="text-xs"><span className="font-semibold uppercase tracking-wider text-muted-foreground">AI</span> · {questions[idx]}</p>
                    <p className="text-xs italic text-foreground/80 pl-2 border-l border-foreground/30">{currentAnswer}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="glass-strong flex flex-col rounded-3xl p-5">
            <h2 className="font-display text-lg font-semibold">Your answer</h2>
            <p className="mt-1 text-xs text-muted-foreground">{phase === "speaking" ? "Listen to the question…" : "Speak naturally or type. Submit when ready."}</p>
            <textarea
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder="Your answer will appear here as you speak…"
              className="mt-3 min-h-[180px] flex-1 resize-none rounded-2xl border border-border bg-background/60 p-3 text-sm outline-none focus:border-foreground/30"
            />
            <div className="mt-3 flex items-center gap-2">
              {!listening ? (
                <button onClick={startListening} disabled={phase !== "listening"} className="glass inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium hover:bg-secondary/60 disabled:opacity-50"><Mic className="h-4 w-4" /> Speak</button>
              ) : (
                <button onClick={stopListening} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground"><MicOff className="h-4 w-4" /> Stop</button>
              )}
              <button onClick={nextQuestion} disabled={phase === "loading" || phase === "speaking" || !currentAnswer.trim() || phase === "finishing"} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {idx + 1 >= questions.length ? "Finish" : "Next"} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
              <p>Snapshots captured: {snapshots.length}</p>
              <p className="mt-1">Answers recorded: {transcript.length}</p>
              {flags.length > 0 && <p className="mt-1 text-destructive">Integrity flags: {flags.length}</p>}
            </div>
            {phase === "finishing" && <div className="mt-3 inline-flex items-center gap-2 text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Scoring your interview…</div>}
            {phase === "done" && <p className="mt-3 text-xs">Complete. Redirecting…</p>}
          </aside>
        </div>
      </main>
    </div>
  );
}
