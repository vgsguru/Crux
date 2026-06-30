import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createLiveSession, finishInterview } from "@/lib/ai.server";
import { Loader2, Sparkles, PhoneOff, Mic, Volume2 } from "lucide-react";
import { toast } from "sonner";

type Seg = { role: "ai" | "you"; text: string };
type Phase = "loading" | "intro" | "connecting" | "live" | "ending";

// Full-duplex spoken interview via the Gemini Live API (native audio).
// Mic PCM16@16k streams up; the model streams PCM16@24k audio back; we show live
// captions and build a transcript for scoring. Falls back to onFallback() on failure.
export function GeminiLiveInterview({ applicationId, onComplete, onFallback }: { applicationId: string; onComplete: (applicationId: string) => void; onFallback: () => void }) {
  const sessionFn = useServerFn(createLiveSession);
  const finishFn = useServerFn(finishInterview);

  const [phase, setPhase] = useState<Phase>("loading");
  const [captions, setCaptions] = useState<Seg[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const sessionRef = useRef<{ apiKey: string; model: string; systemInstruction: string; interviewId: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nextStartRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const segsRef = useRef<Seg[]>([]);
  const endedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const s: any = await sessionFn({ data: { applicationId } });
        sessionRef.current = s;
        setPhase("intro");
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't start live interview");
        onFallback();
      }
    })();
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    try { wsRef.current?.close(); } catch { /* */ }
    try { procRef.current?.disconnect(); } catch { /* */ }
    try { micCtxRef.current?.close(); } catch { /* */ }
    try { playCtxRef.current?.close(); } catch { /* */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function pushSeg(role: "ai" | "you", text: string) {
    const segs = segsRef.current;
    const last = segs[segs.length - 1];
    if (last && last.role === role) last.text += text;
    else segs.push({ role, text });
    setCaptions([...segs]);
  }

  function stopPlayback() {
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch { /* */ } });
    sourcesRef.current = [];
    nextStartRef.current = 0;
  }

  function playPcm(b64: string) {
    const ctx = playCtxRef.current!;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const start = Math.max(now, nextStartRef.current);
    src.start(start);
    nextStartRef.current = start + buf.duration;
    setAiSpeaking(true);
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
      if (sourcesRef.current.length === 0) setAiSpeaking(false);
    };
    sourcesRef.current.push(src);
  }

  async function begin() {
    const sess = sessionRef.current!;
    setPhase("connecting");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (videoRef.current) videoRef.current.srcObject = streamRef.current;
    } catch { toast.error("Microphone permission is required"); setPhase("intro"); return; }

    const PlayCtx = (window.AudioContext || (window as any).webkitAudioContext);
    micCtxRef.current = new PlayCtx({ sampleRate: 16000 });
    playCtxRef.current = new PlayCtx({ sampleRate: 24000 });

    const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(sess.apiKey)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/" + sess.model,
          generationConfig: { responseModalities: ["AUDIO"] },
          systemInstruction: { parts: [{ text: sess.systemInstruction }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
    };

    ws.onmessage = async (ev) => {
      let txt: string;
      if (typeof ev.data === "string") txt = ev.data;
      else if (ev.data instanceof Blob) txt = await ev.data.text();
      else txt = new TextDecoder().decode(ev.data);
      let msg: any; try { msg = JSON.parse(txt); } catch { return; }

      if (msg.setupComplete) { setPhase("live"); startMic(); return; }
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.interrupted) stopPlayback();
      if (sc.outputTranscription?.text) pushSeg("ai", sc.outputTranscription.text);
      if (sc.inputTranscription?.text) pushSeg("you", sc.inputTranscription.text);
      const parts = sc.modelTurn?.parts ?? [];
      for (const p of parts) {
        const data = p.inlineData?.data;
        if (data) playPcm(data);
      }
      // The model signals the end verbally; auto-wrap shortly after.
      const aiText = segsRef.current.filter((s) => s.role === "ai").map((s) => s.text).join(" ").toLowerCase();
      if (!endedRef.current && aiText.includes("concludes our interview")) {
        endedRef.current = true;
        setTimeout(() => finalize(), 3500);
      }
    };

    ws.onclose = (e) => { if (phase === "live" && !endedRef.current) toast.message(`Interview ended${e.reason ? ": " + e.reason : ""}`); };
    ws.onerror = () => { toast.error("Live connection error"); };
  }

  function startMic() {
    const ctx = micCtxRef.current!;
    const source = ctx.createMediaStreamSource(streamRef.current!);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;
    proc.onaudioprocess = (e) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      const bytes = new Uint8Array(i16.buffer);
      let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      wsRef.current.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(bin), mimeType: "audio/pcm;rate=16000" } } }));
    };
    source.connect(proc);
    proc.connect(ctx.destination); // required for the processor to fire (outputs silence)
  }

  async function finalize() {
    if (phase === "ending") return;
    setPhase("ending");
    stopPlayback();
    cleanup();
    // Build Q/A pairs from the captions for scoring.
    const segs = segsRef.current;
    const transcript: { q: string; a: string }[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].role === "ai") {
        const a = segs[i + 1]?.role === "you" ? segs[i + 1].text : "";
        transcript.push({ q: segs[i].text.trim(), a: a.trim() });
      }
    }
    const clean = transcript.filter((t) => t.q || t.a);
    try {
      await finishFn({ data: { interviewId: sessionRef.current!.interviewId, transcript: clean.length ? clean : [{ q: "Live interview", a: segs.map((s) => `${s.role}: ${s.text}`).join("\n") }] } });
      toast.success("Interview complete — generating your report");
    } catch (e: any) { toast.error(e?.message ?? "Could not finalize"); }
    onComplete(applicationId);
  }

  if (phase === "loading") return <div className="glass-strong rounded-3xl p-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" /> Preparing your interview…</div>;

  if (phase === "intro") {
    return (
      <div className="glass-strong rounded-3xl p-8 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-3 font-display text-2xl font-bold">Live AI interview</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">You'll have a real spoken conversation with the AI interviewer — it listens, responds in a natural voice, and asks follow-ups. Speak naturally; you can interrupt it. Live captions show below.</p>
        <button onClick={begin} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"><Volume2 className="h-4 w-4" /> Start conversation</button>
        <p className="mt-3 text-xs text-muted-foreground">Allow microphone access. Use headphones to avoid echo. Chrome/Edge recommended.</p>
      </div>
    );
  }

  if (phase === "ending") return <div className="glass-strong rounded-3xl p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mt-3 text-sm text-muted-foreground">Scoring your interview…</p></div>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="glass-strong flex min-h-[260px] flex-col rounded-3xl p-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
            {phase === "connecting" ? <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</> : aiSpeaking ? <><Volume2 className="h-4 w-4 animate-pulse" /> Interviewer speaking</> : <><Mic className="h-4 w-4 text-emerald-500" /> Listening — go ahead</>}
          </div>
          <div className="mt-3 flex-1 space-y-2 overflow-y-auto text-sm">
            {captions.length === 0 && phase === "live" && <p className="text-muted-foreground">The interviewer will greet you in a moment…</p>}
            {captions.map((s, i) => (
              <p key={i} className={s.role === "ai" ? "text-foreground" : "text-foreground/60"}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.role === "ai" ? "Interviewer" : "You"}: </span>{s.text}
              </p>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-3xl bg-black"><video ref={videoRef} autoPlay muted playsInline className="h-full min-h-[140px] w-full object-cover" /></div>
      </div>
      <button onClick={finalize} className="inline-flex items-center gap-2 rounded-full bg-destructive/90 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"><PhoneOff className="h-4 w-4" /> End interview</button>
    </div>
  );
}
