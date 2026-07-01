import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { db } from "@/integrations/firebase/client";
import { doc, getDoc, addDoc, collection } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { ArrowLeft, RefreshCw, Quote, ArrowRight, BarChart2, Video, ShieldCheck, CalendarClock, Check } from "lucide-react";
import { consumeRetake } from "@/lib/ai.server";
import { confirmMeetingSlot } from "@/lib/applications.server";
import { computeResumeMatch, getApplicationPercentile } from "@/lib/scoring.server";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/me/applications/$applicationId")({
  component: CandidateApplicationDetail,
});

type Evidence = Record<string, { justification: string; citations: Array<{ source: string; quote: string }> }>;

function CandidateApplicationDetail() {
  const { applicationId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const consumeFn = useServerFn(consumeRetake);
  const confirmSlotFn = useServerFn(confirmMeetingSlot);

  async function requestReview() {
    if (!user) { toast.error("Sign in first"); return; }
    const reason = window.prompt("Tell us why you'd like a human to review this score:");
    if (reason === null) return;
    try {
      await addDoc(collection(db, "reports"), {
        content_type: "score_dispute",
        application_id: applicationId,
        reported_by: user.id,
        reason: reason.trim().slice(0, 1000),
        status: "open",
        created_at: new Date().toISOString(),
      });
      toast.success("Review requested — the recruiter will be notified.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't submit");
    }
  }

  const { data: app, refetch } = useQuery({
    queryKey: ["my-app-detail", applicationId],
    queryFn: async () => {
      const docSnap = await getDoc(doc(db, "applications", applicationId));
      if (!docSnap.exists()) return null;
      const application = { id: docSnap.id, ...docSnap.data() } as any;

      if (application.job_id) {
        const jobSnap = await getDoc(doc(db, "jobs", application.job_id));
        if (jobSnap.exists()) {
          const jobData = jobSnap.data();
          application.jobs = { id: jobSnap.id, title: jobData.title, interview_mode: jobData.interview_mode, companies: null };
          if (jobData.company_id) {
            const compSnap = await getDoc(doc(db, "companies", jobData.company_id));
            if (compSnap.exists()) {
              application.jobs.companies = { name: compSnap.data().name };
            }
          }
        }
      }

      return application as unknown as {
        id: string; status: string; score: number | null;
        score_breakdown: Record<string, number> | null;
        score_evidence: Evidence | null;
        ai_summary: string | null;
        ai_highlights: { strengths: string[]; concerns: string[]; recommendation: string } | null;
        resume_match: { matched_skills: string[]; gaps: string[]; extras: string[]; overall_pct: number; summary: string } | null;
        retake_allowed: boolean; retake_count: number;
        meeting_slots?: string[] | null; meeting_confirmed?: string | null; meeting_note?: string | null;
        jobs: { id: string; title: string; interview_mode: "async" | "live" | null; companies: { name: string } | null } | null;
      } | null;
    },
  });

  const confirmSlot = useMutation({
    mutationFn: async (slot: string) => confirmSlotFn({ data: { applicationId, slot } }),
    onSuccess: () => { toast.success("Meeting confirmed!"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const matchFn = useServerFn(computeResumeMatch);
  const pctFn = useServerFn(getApplicationPercentile);
  const { data: pct } = useQuery({
    queryKey: ["app-pct", applicationId],
    queryFn: async () => pctFn({ data: { applicationId } }) as Promise<{ percentile: number | null }>,
  });
  const runMatch = useMutation({
    mutationFn: async () => matchFn({ data: { applicationId } }),
    onSuccess: () => { toast.success("Resume match computed"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  async function onRetake() {
    if (!app) return;
    if (!confirm("Start your retake now? Your previous interview answers and score will be cleared.")) return;
    try {
      await consumeFn({ data: { applicationId: app.id } });
      toast.success("Retake unlocked. Continue your interview.");
      await navigate({ to: "/apply/$jobId", params: { jobId: app.jobs!.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start retake");
      void refetch();
    }
  }

  if (!app) return <div className="bg-ambient min-h-screen"><SiteNav /><div className="p-10 text-center">Loading…</div></div>;
  const evidence = app.score_evidence ?? {};
  const breakdown = app.score_breakdown ?? {};

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/me/applications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>

        <div className="glass-strong mt-4 flex items-start justify-between rounded-3xl p-7">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{app.jobs?.companies?.name}</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">{app.jobs?.title}</h1>
            <p className="mt-2 text-xs capitalize text-muted-foreground">{app.status.replace(/_/g, " ")}</p>
            {app.ai_summary && <p className="mt-3 max-w-xl text-sm text-foreground/80">{app.ai_summary}</p>}
          </div>
          <div className="text-right">
            <div className="font-display text-5xl font-bold">{app.score?.toFixed(0) ?? "—"}</div>
            <p className="text-xs text-muted-foreground">/ 100</p>
            {typeof pct?.percentile === "number" && (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wider"><BarChart2 className="h-3 w-3" /> Top {(100 - pct.percentile).toFixed(0)}%</p>
            )}
          </div>
        </div>

        {/* Meeting scheduling */}
        {app.status === "meeting_proposed" && Array.isArray(app.meeting_slots) && app.meeting_slots.length > 0 && (
          <div className="glass-strong mt-4 rounded-3xl p-6">
            <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /><h3 className="font-display text-lg font-semibold">Pick a meeting time</h3></div>
            <p className="mt-1 text-sm text-muted-foreground">{app.jobs?.companies?.name ?? "The recruiter"} proposed these times{app.meeting_note ? ` — ${app.meeting_note}` : ""}. Choose one:</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {app.meeting_slots.map((s) => (
                <button key={s} onClick={() => confirmSlot.mutate(s)} disabled={confirmSlot.isPending} className="flex items-center justify-between rounded-2xl border border-border bg-background/50 px-4 py-3 text-sm font-medium hover:border-primary/40 hover:bg-secondary/50 disabled:opacity-50">
                  {new Date(s).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}
        {app.status === "meeting_scheduled" && app.meeting_confirmed && (
          <div className="glass mt-4 flex items-center gap-3 rounded-3xl p-6">
            <Check className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="font-display text-sm font-semibold">Meeting confirmed</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{new Date(app.meeting_confirmed).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}{app.meeting_note ? ` · ${app.meeting_note}` : ""}</p>
            </div>
          </div>
        )}

        {app.jobs?.interview_mode === "async" && app.status !== "scored" && (
          <div className="glass mt-4 flex items-center justify-between rounded-3xl p-6">
            <div>
              <p className="font-display text-sm font-semibold">Async video interview ready</p>
              <p className="mt-1 text-xs text-muted-foreground">Record short video answers on your own time.</p>
            </div>
            <Link to="/apply/$jobId/interview" params={{ jobId: app.jobs.id }} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"><Video className="h-4 w-4" /> Start interview <ArrowRight className="h-4 w-4" /></Link>
          </div>
        )}

        <div className="glass mt-4 rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Resume vs role</h3>
              {app.resume_match ? (
                <>
                  <p className="mt-2 font-display text-2xl font-bold">{app.resume_match.overall_pct.toFixed(0)}%<span className="ml-1 text-xs font-normal text-muted-foreground">match</span></p>
                  <p className="mt-1 text-sm text-foreground/80">{app.resume_match.summary}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Matched</p>
                      <ul className="mt-1 space-y-0.5 text-xs">{app.resume_match.matched_skills?.slice(0, 6).map((s, i) => <li key={i}>• {s}</li>)}</ul>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gaps</p>
                      <ul className="mt-1 space-y-0.5 text-xs">{app.resume_match.gaps?.slice(0, 6).map((s, i) => <li key={i}>• {s}</li>)}</ul>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Extras</p>
                      <ul className="mt-1 space-y-0.5 text-xs">{app.resume_match.extras?.slice(0, 6).map((s, i) => <li key={i}>• {s}</li>)}</ul>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">See how your resume aligns with what the recruiter is looking for.</p>
              )}
            </div>
            <button onClick={() => runMatch.mutate()} disabled={runMatch.isPending} className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-foreground hover:text-background disabled:opacity-50">{runMatch.isPending ? "Analyzing…" : app.resume_match ? "Re-analyze" : "Run analysis"}</button>
          </div>
        </div>

        {app.retake_allowed && (app.retake_count ?? 0) < 1 && (
          <div className="glass mt-4 flex items-center justify-between rounded-3xl p-6">
            <div>
              <p className="font-display text-sm font-semibold">A retake has been granted</p>
              <p className="mt-1 text-xs text-muted-foreground">The recruiter has unlocked one retake of your AI interview. Your previous answers and score will be cleared.</p>
            </div>
            <button onClick={onRetake} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              <RefreshCw className="h-4 w-4" /> Start retake <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {app.ai_highlights && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {app.ai_highlights.strengths?.length > 0 && (
              <div className="glass rounded-3xl p-6">
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">What worked</h3>
                <ul className="mt-3 space-y-2 text-sm">{app.ai_highlights.strengths.map((s, i) => <li key={i} className="flex gap-2"><span className="text-foreground/40">•</span><span className="text-foreground/80">{s}</span></li>)}</ul>
              </div>
            )}
            {app.ai_highlights.concerns?.length > 0 && (
              <div className="glass rounded-3xl p-6">
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Areas to grow</h3>
                <ul className="mt-3 space-y-2 text-sm">{app.ai_highlights.concerns.map((s, i) => <li key={i} className="flex gap-2"><span className="text-foreground/40">•</span><span className="text-foreground/80">{s}</span></li>)}</ul>
              </div>
            )}
          </div>
        )}

        {Object.keys(breakdown).length > 0 && (
          <div className="glass mt-4 rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Score breakdown</h2>
            <p className="mt-1 text-xs text-muted-foreground">Each criterion is backed by quotes from your resume, intro pitch, and interview answers.</p>
            <div className="mt-5 space-y-4">
              {Object.entries(breakdown).map(([k, v]) => {
                const ev = evidence[k];
                return (
                  <div key={k} className="rounded-2xl border border-border bg-background/40 p-5">
                    <div className="flex items-baseline justify-between">
                      <p className="font-display text-sm font-semibold uppercase tracking-wider">{k.replace(/_/g, " ")}</p>
                      <p className="font-display text-2xl font-bold">{typeof v === "number" ? v.toFixed(0) : String(v)}</p>
                    </div>
                    {ev?.justification && <p className="mt-2 text-sm text-foreground/80">{ev.justification}</p>}
                    {ev?.citations?.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {ev.citations.map((c, i) => (
                          <li key={i} className="flex gap-2 rounded-xl bg-secondary/60 p-3 text-xs">
                            <Quote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                            <div>
                              <p className="font-semibold uppercase tracking-wider text-muted-foreground">{c.source}</p>
                              <p className="mt-0.5 italic text-foreground/80">"{c.quote}"</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {app.status === "scored" && (
          <div className="glass mt-4 rounded-3xl p-6">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> How this score works</h3>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <li>• You're scored only on your answers, resume, and pitch — never on age, gender, or background.</li>
              <li>• Every criterion above is backed by verbatim quotes, so nothing is a black box.</li>
              <li>• Think the AI got it wrong? Ask a human on the hiring team to review it.</li>
            </ul>
            <button onClick={requestReview} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-xs font-medium hover:bg-secondary/70">
              Request a human review
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
