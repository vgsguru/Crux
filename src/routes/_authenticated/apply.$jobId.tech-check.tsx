import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { CheckCircle2, XCircle, Camera, Mic, Wifi, ArrowRight, RefreshCw } from "lucide-react";
import { SiteNav } from "@/components/site-nav";

export const Route = createFileRoute("/_authenticated/apply/$jobId/tech-check")({
  component: TechCheck,
});

type CheckStatus = "idle" | "pending" | "pass" | "fail";

interface Check {
  id: string;
  label: string;
  sublabel: string;
  status: CheckStatus;
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "pending") return <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />;
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
  return <div className="h-4 w-4 rounded-full border-2 border-border" />;
}

function TechCheck() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [checks, setChecks] = useState<Check[]>([
    { id: "camera", label: "Camera", sublabel: "Video input detected", status: "idle" },
    { id: "mic", label: "Microphone", sublabel: "Audio input detected", status: "idle" },
    { id: "connection", label: "Connection", sublabel: "Network speed sufficient", status: "idle" },
    { id: "browser", label: "Browser", sublabel: "MediaRecorder API available", status: "idle" },
  ]);

  const setStatus = (id: string, status: CheckStatus) =>
    setChecks((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));

  useEffect(() => {
    runChecks();
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  async function runChecks() {
    setChecks((cs) => cs.map((c) => ({ ...c, status: "idle" })));
    await new Promise((r) => setTimeout(r, 300));

    // Browser check
    setStatus("browser", "pending");
    await new Promise((r) => setTimeout(r, 400));
    const browserOk = typeof MediaRecorder !== "undefined";
    setStatus("browser", browserOk ? "pass" : "fail");

    // Camera + Mic together
    setStatus("camera", "pending");
    setStatus("mic", "pending");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setStatus("camera", "pass");
      setStatus("mic", "pass");
    } catch (err) {
      setStatus("camera", "fail");
      setStatus("mic", "fail");
    }

    // Connection check via a tiny fetch
    setStatus("connection", "pending");
    try {
      const start = performance.now();
      await fetch("https://www.google.com/favicon.ico", { cache: "no-cache", mode: "no-cors" });
      const ms = performance.now() - start;
      setStatus("connection", ms < 5000 ? "pass" : "fail");
    } catch {
      setStatus("connection", "fail");
    }
  }

  const allDone = checks.every((c) => c.status === "pass" || c.status === "fail");
  const allPassed = checks.every((c) => c.status === "pass");
  const anyFailed = checks.some((c) => c.status === "fail");

  function proceed() {
    navigate({ to: "/apply/$jobId", params: { jobId } });
  }

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-lg px-4 py-16">
        <div className="glass-strong rounded-3xl p-8 sm:p-12">
          <div className="text-center">
            <h1 className="font-display text-3xl font-bold tracking-tight">Tech Check</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We'll verify your device is ready before the interview.
            </p>
          </div>

          {/* Live camera preview */}
          <div className="mt-8 overflow-hidden rounded-2xl bg-black aspect-video">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          </div>

          {/* Checklist */}
          <ul className="mt-6 space-y-3">
            {checks.map((check) => (
              <li key={check.id} className="glass flex items-center gap-4 rounded-2xl px-4 py-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary">
                  {check.id === "camera" && <Camera className="h-4 w-4 text-muted-foreground" />}
                  {check.id === "mic" && <Mic className="h-4 w-4 text-muted-foreground" />}
                  {check.id === "connection" && <Wifi className="h-4 w-4 text-muted-foreground" />}
                  {check.id === "browser" && <CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-xs text-muted-foreground">{check.sublabel}</p>
                </div>
                <StatusIcon status={check.status} />
              </li>
            ))}
          </ul>

          {/* Actions */}
          <div className="mt-8 space-y-3">
            {anyFailed && (
              <button
                onClick={runChecks}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium transition hover:bg-secondary"
              >
                <RefreshCw className="h-4 w-4" /> Retry checks
              </button>
            )}
            <button
              onClick={proceed}
              disabled={!allDone}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition ${
                allPassed
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-secondary text-muted-foreground"
              } disabled:opacity-50`}
            >
              {!allDone
                ? "Running checks…"
                : allPassed
                ? "Continue to application"
                : "Continue anyway"}{" "}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
