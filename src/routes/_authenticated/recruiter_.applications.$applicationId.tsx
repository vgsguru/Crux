import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, limit, getDocs, getDoc, doc } from "firebase/firestore";
import { SiteNav } from "@/components/site-nav";
import { ArrowLeft, FileText, Play, Check, AlertTriangle, Download, RefreshCw, Quote, Clock, BarChart2 } from "lucide-react";
import { setRetakeAllowed } from "@/lib/ai.server";
import { computeResumeMatch, getApplicationPercentile } from "@/lib/scoring.server";
import { inviteToInterview, decideCandidate, proposeMeeting } from "@/lib/applications.server";
import { toast } from "sonner";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_authenticated/recruiter_/applications/$applicationId")({
  component: ApplicationReview,
});

type Highlights = { strengths: string[]; concerns: string[]; recommendation: string };
type Evidence = Record<string, { justification: string; citations: Array<{ source: string; quote: string }> }>;
type AuditEntry = { at: string; by: string; action: string; note?: string | null };

type AppData = {
  id: string; status: string; pipeline_status: string; score: number | null;
  score_breakdown: Record<string, number> | null; score_evidence: Evidence | null;
  ai_summary: string | null; ai_highlights: Highlights | null;
  resume_match: { matched_skills: string[]; gaps: string[]; extras: string[]; overall_pct: number; summary: string } | null;
  screening_answers?: { q: string; a: string }[];
  meeting_slots?: string[] | null; meeting_confirmed?: string | null;
  resume_url: string | null; resume_text: string | null;
  intro_video_url: string | null; intro_transcript: string | null;
  retake_allowed: boolean; retake_count: number; audit_log: AuditEntry[];
  profiles: { full_name: string | null } | null; jobs: { title: string; companies?: { name: string } | null } | null;
  interviews: { video_url: string | null; transcript: Array<{ q: string; a: string }>; snapshots: string[]; flags: string[] } | null;
};

function ApplicationReview() {
  const { applicationId } = Route.useParams();
  const setRetakeFn = useServerFn(setRetakeAllowed);
  const matchFn = useServerFn(computeResumeMatch);
  const pctFn = useServerFn(getApplicationPercentile);
  const { data: pct } = useQuery({
    queryKey: ["recruiter-app-pct", applicationId],
    queryFn: async () => pctFn({ data: { applicationId } }) as Promise<{ percentile: number | null }>,
  });
  const inviteFn = useServerFn(inviteToInterview);
  const [deadlineDays, setDeadlineDays] = useState(7);
  const invite = useMutation({
    mutationFn: async () => inviteFn({ data: { applicationId, deadlineDays } }),
    onSuccess: () => { toast.success("Candidate invited — email sent with deadline"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const decideFn = useServerFn(decideCandidate);
  const decide = useMutation({
    mutationFn: async (v: { action: "offer" | "schedule" | "reject"; details?: string }) => decideFn({ data: { applicationId, ...v } }),
    onSuccess: (_d, v) => { toast.success(v.action === "reject" ? "Candidate notified" : v.action === "offer" ? "Offer sent" : "Meeting request sent"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  function runDecision(action: "offer" | "reject") {
    const labels = { offer: "Add an optional note for the offer email:", reject: "Optional message to the candidate:" } as const;
    const details = window.prompt(labels[action]) ?? "";
    if (action === "reject" && !window.confirm("Send rejection to this candidate?")) return;
    decide.mutate({ action, details });
  }
  // Calendly-style: propose time slots the candidate picks from.
  const proposeFn = useServerFn(proposeMeeting);
  const [showSlots, setShowSlots] = useState(false);
  const [slots, setSlots] = useState<string[]>(["", ""]);
  const [slotNote, setSlotNote] = useState("");
  const propose = useMutation({
    mutationFn: async () => {
      const chosen = slots.map((s) => s.trim()).filter(Boolean).map((s) => new Date(s).toISOString());
      if (!chosen.length) throw new Error("Add at least one time slot");
      return proposeFn({ data: { applicationId, slots: chosen, note: slotNote.trim() || undefined } });
    },
    onSuccess: () => { toast.success("Time slots sent — the candidate will pick one"); setShowSlots(false); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const runMatch = useMutation({
    mutationFn: async () => matchFn({ data: { applicationId } }),
    onSuccess: () => { toast.success("Resume match computed"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const { data: app, refetch } = useQuery({
    queryKey: ["app-review", applicationId],
    queryFn: async () => {
      const appSnap = await getDoc(doc(db, "applications", applicationId));
      if (!appSnap.exists()) return null;
      const application = { id: appSnap.id, ...appSnap.data() } as any;

      // Resolve the relational joins manually (Firestore has no server-side joins).
      application.profiles = null;
      if (application.applicant_id) {
        const pSnap = await getDoc(doc(db, "profiles", application.applicant_id));
        if (pSnap.exists()) application.profiles = { full_name: pSnap.data().full_name ?? null };
      }

      application.jobs = null;
      if (application.job_id) {
        const jSnap = await getDoc(doc(db, "jobs", application.job_id));
        if (jSnap.exists()) {
          const jobData = jSnap.data();
          application.jobs = { title: jobData.title, companies: null };
          if (jobData.company_id) {
            const cSnap = await getDoc(doc(db, "companies", jobData.company_id));
            if (cSnap.exists()) application.jobs.companies = { name: cSnap.data().name };
          }
        }
      }

      application.interviews = null;
      const iSnap = await getDocs(query(
        collection(db, "interviews"),
        where("application_id", "==", applicationId),
        limit(1),
      ));
      if (!iSnap.empty) {
        const iv = iSnap.docs[0].data();
        application.interviews = {
          video_url: iv.video_url ?? null,
          transcript: Array.isArray(iv.transcript) ? iv.transcript : [],
          snapshots: Array.isArray(iv.snapshots) ? iv.snapshots : [],
          flags: Array.isArray(iv.flags) ? iv.flags : [],
        };
      }

      return application as unknown as AppData;
    },
  });

  async function toggleRetake() {
    if (!app) return;
    const next = !app.retake_allowed;
    try {
      await setRetakeFn({ data: { applicationId: app.id, allowed: next } });
      toast.success(next ? "Retake granted to candidate" : "Retake offer revoked");
      void refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update retake");
    }
  }

  function exportPdf() {
    if (!app) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48;
    let y = M;
    const ensure = (n: number) => { if (y + n > H - M) { doc.addPage(); y = M; } };
    const write = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
      const size = opts.size ?? 10;
      doc.setFont("helvetica", opts.bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...(opts.color ?? [20, 20, 20]));
      const lines = doc.splitTextToSize(text, W - M * 2);
      for (const line of lines) {
        ensure(size + 4);
        doc.text(line, M, y);
        y += size + 4;
      }
      y += opts.gap ?? 4;
    };
    const rule = () => { ensure(12); doc.setDrawColor(220); doc.line(M, y, W - M, y); y += 12; };

    write("Interview Review", { size: 22, bold: true, gap: 2 });
    write(`${app.jobs?.title ?? ""}${app.jobs?.companies?.name ? ` · ${app.jobs.companies.name}` : ""}`, { size: 10, color: [110, 110, 110] });
    write(`Candidate: ${app.profiles?.full_name ?? "Applicant"}`, { size: 10, color: [110, 110, 110] });
    write(`Generated: ${new Date().toLocaleString()}`, { size: 9, color: [140, 140, 140], gap: 12 });

    // Score block
    write(`Score: ${app.score?.toFixed(0) ?? "—"} / 100`, { size: 16, bold: true });
    if (app.ai_highlights?.recommendation) write(`Recommendation: ${app.ai_highlights.recommendation}`, { size: 11, bold: true });
    if (app.ai_summary) write(app.ai_summary, { size: 10, color: [60, 60, 60], gap: 10 });
    rule();

    // Rubric + evidence
    if (app.score_breakdown && Object.keys(app.score_breakdown).length) {
      write("Score breakdown with evidence", { size: 14, bold: true, gap: 6 });
      for (const [k, v] of Object.entries(app.score_breakdown)) {
        write(`${k.replace(/_/g, " ").toUpperCase()} — ${typeof v === "number" ? v.toFixed(0) : v}`, { size: 11, bold: true });
        const ev = app.score_evidence?.[k];
        if (ev?.justification) write(ev.justification, { size: 10, color: [60, 60, 60] });
        if (ev?.citations?.length) {
          for (const c of ev.citations) {
            write(`  [${c.source}] "${c.quote}"`, { size: 9, color: [90, 90, 90] });
          }
        }
        y += 4;
      }
      rule();
    }

    // Highlights
    if (app.ai_highlights) {
      if (app.ai_highlights.strengths?.length) {
        write("Strengths", { size: 12, bold: true });
        for (const s of app.ai_highlights.strengths) write(`• ${s}`, { size: 10 });
        y += 4;
      }
      if (app.ai_highlights.concerns?.length) {
        write("Concerns", { size: 12, bold: true });
        for (const s of app.ai_highlights.concerns) write(`• ${s}`, { size: 10 });
        y += 4;
      }
      rule();
    }

    // Transcript
    if (app.interviews?.transcript?.length) {
      write("Interview transcript", { size: 14, bold: true, gap: 6 });
      for (const t of app.interviews.transcript) {
        write(`Q: ${t.q}`, { size: 10, bold: true });
        write(`A: ${t.a || "(no answer)"}`, { size: 10, color: [60, 60, 60], gap: 6 });
      }
      rule();
    }

    // Proctoring flags
    if (app.interviews?.flags?.length) {
      write("Proctoring flags", { size: 14, bold: true, gap: 4 });
      for (const f of app.interviews.flags) write(`• ${f}`, { size: 10 });
    } else {
      write("Proctoring flags: none", { size: 11, color: [110, 110, 110] });
    }

    // Audit
    if (app.audit_log?.length) {
      rule();
      write("Audit trail", { size: 12, bold: true, gap: 4 });
      for (const e of app.audit_log) {
        write(`${new Date(e.at).toLocaleString()} — ${e.action}${e.note ? ` (${e.note})` : ""}`, { size: 9, color: [90, 90, 90] });
      }
    }

    const safeName = (app.profiles?.full_name ?? "candidate").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    doc.save(`review-${safeName}-${app.id.slice(0, 8)}.pdf`);
  }

  if (!app) return <div className="bg-ambient min-h-screen"><SiteNav /><div className="p-10 text-center">Loading…</div></div>;
  const h = app.ai_highlights;
  const evidence = app.score_evidence ?? {};
  const breakdown = app.score_breakdown ?? {};
  const retakeUsed = (app.retake_count ?? 0) >= 1;

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/recruiter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
          <div className="flex flex-wrap items-center gap-2">
            {app.status === "interview_invited" || app.status === "interview_in_progress" || app.status === "scored" || app.status === "offer_sent" || app.status === "meeting_proposed" || app.status === "meeting_scheduled" || app.status === "rejected" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary"><Check className="h-4 w-4" /> Invited to interview</span>
            ) : (
              <>
                <select value={deadlineDays} onChange={(e) => setDeadlineDays(Number(e.target.value))} className="rounded-full border border-border bg-background px-3 py-2 text-xs" title="Deadline">
                  <option value={3}>3 days</option><option value={5}>5 days</option><option value={7}>7 days</option><option value={14}>14 days</option>
                </select>
                <button onClick={() => invite.mutate()} disabled={invite.isPending} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
                  <Check className="h-4 w-4" /> {invite.isPending ? "Inviting…" : "Invite to interview"}
                </button>
              </>
            )}
            <button onClick={exportPdf} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Download className="h-4 w-4" /> Export PDF
            </button>
          </div>
        </div>

        <div className="glass-strong mt-4 flex items-start justify-between rounded-3xl p-7">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{app.jobs?.title}</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">{app.profiles?.full_name || "Applicant"}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-secondary px-3 py-1 capitalize">{app.pipeline_status?.replace(/_/g, " ")}</span>
              {h?.recommendation && <span className="rounded-full bg-primary px-3 py-1 text-primary-foreground">{h.recommendation}</span>}
              {retakeUsed && <span className="rounded-full bg-secondary px-3 py-1">Retake used</span>}
            </div>
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

        <div className="glass mt-4 rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Resume vs role</h3>
              {app.resume_match ? (
                <>
                  <p className="mt-2 font-display text-2xl font-bold">{app.resume_match.overall_pct.toFixed(0)}%<span className="ml-1 text-xs font-normal text-muted-foreground">match</span></p>
                  <p className="mt-1 text-sm text-foreground/80">{app.resume_match.summary}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
                    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Matched</p><ul className="mt-1 space-y-0.5">{app.resume_match.matched_skills?.slice(0, 6).map((s, i) => <li key={i}>• {s}</li>)}</ul></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gaps</p><ul className="mt-1 space-y-0.5">{app.resume_match.gaps?.slice(0, 6).map((s, i) => <li key={i}>• {s}</li>)}</ul></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Extras</p><ul className="mt-1 space-y-0.5">{app.resume_match.extras?.slice(0, 6).map((s, i) => <li key={i}>• {s}</li>)}</ul></div>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Generate an AI comparison between this resume and the role's ideal candidate.</p>
              )}
            </div>
            <button onClick={() => runMatch.mutate()} disabled={runMatch.isPending} className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-foreground hover:text-background disabled:opacity-50">{runMatch.isPending ? "Analyzing…" : app.resume_match ? "Re-analyze" : "Run analysis"}</button>
          </div>
        </div>

        {/* Phase-1 screening answers */}
        {app.screening_answers && app.screening_answers.length > 0 && (
          <div className="glass mt-4 rounded-3xl p-5">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Phase 1 — screening answers</h3>
            <div className="mt-3 space-y-3">
              {app.screening_answers.map((qa, i) => (
                <div key={i}>
                  <p className="text-sm font-medium">{i + 1}. {qa.q}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/75">{qa.a || <span className="italic text-muted-foreground">(no answer)</span>}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Final decision */}
        <div className="glass-strong mt-4 rounded-3xl p-5">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Final decision</h3>
          {app.status === "offer_sent" ? (
            <p className="mt-2 text-sm font-medium text-emerald-600">✓ Offer sent to candidate.</p>
          ) : app.status === "meeting_proposed" ? (
            <p className="mt-2 text-sm font-medium text-primary">✓ Time slots sent — waiting for the candidate to pick one.</p>
          ) : app.status === "meeting_scheduled" ? (
            <p className="mt-2 text-sm font-medium text-primary">✓ Meeting confirmed{app.meeting_confirmed ? ` for ${new Date(app.meeting_confirmed).toLocaleString()}` : ""}.</p>
          ) : app.status === "rejected" ? (
            <p className="mt-2 text-sm font-medium text-muted-foreground">Candidate was not selected.</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">Choose who to recruit. The candidate is emailed and notified.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => runDecision("offer")} disabled={decide.isPending} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"><Check className="h-4 w-4" /> Send offer</button>
                <button onClick={() => setShowSlots((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"><Clock className="h-4 w-4" /> Schedule meeting</button>
                <button onClick={() => runDecision("reject")} disabled={decide.isPending} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><AlertTriangle className="h-4 w-4" /> Reject</button>
              </div>
              {showSlots && (
                <div className="mt-4 rounded-2xl border border-border bg-background/50 p-4">
                  <p className="text-xs font-medium">Propose 1–4 time slots — the candidate picks one.</p>
                  <div className="mt-2 space-y-2">
                    {slots.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="datetime-local" value={s} onChange={(e) => setSlots((arr) => arr.map((x, j) => j === i ? e.target.value : x))} className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm" />
                        {slots.length > 1 && <button onClick={() => setSlots((arr) => arr.filter((_, j) => j !== i))} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"><AlertTriangle className="h-3.5 w-3.5 rotate-45" /></button>}
                      </div>
                    ))}
                    {slots.length < 4 && <button onClick={() => setSlots((arr) => [...arr, ""])} className="text-xs font-medium text-primary hover:underline">+ Add another slot</button>}
                  </div>
                  <input value={slotNote} onChange={(e) => setSlotNote(e.target.value)} placeholder="Optional note (e.g. video-call link)" className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
                  <button onClick={() => propose.mutate()} disabled={propose.isPending} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{propose.isPending ? "Sending…" : "Send time slots"}</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Retake control */}
        <div className="glass mt-4 flex items-center justify-between rounded-3xl p-5">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="font-display text-sm font-semibold">Allow one retake</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {retakeUsed
                  ? "Candidate has already used their one retake."
                  : app.retake_allowed
                    ? "Retake granted. Candidate can re-run the AI interview once."
                    : "Toggle on to let this candidate redo the AI interview a single time."}
              </p>
            </div>
          </div>
          <button
            onClick={toggleRetake}
            disabled={retakeUsed}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${app.retake_allowed ? "bg-primary" : "bg-secondary"}`}
            aria-pressed={app.retake_allowed}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${app.retake_allowed ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {h && (h.strengths?.length || h.concerns?.length) ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {h.strengths?.length > 0 && (
              <div className="glass rounded-3xl p-6">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground"><Check className="h-4 w-4 text-foreground" /> Strengths</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {h.strengths.map((s, i) => <li key={i} className="flex gap-2"><span className="text-foreground/40">•</span> <span className="text-foreground/80">{s}</span></li>)}
                </ul>
              </div>
            )}
            {h.concerns?.length > 0 && (
              <div className="glass rounded-3xl p-6">
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground"><AlertTriangle className="h-4 w-4 text-foreground" /> Concerns</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {h.concerns.map((s, i) => <li key={i} className="flex gap-2"><span className="text-foreground/40">•</span> <span className="text-foreground/80">{s}</span></li>)}
                </ul>
              </div>
            )}
          </div>
        ) : null}

        {Object.keys(breakdown).length > 0 && (
          <div className="glass mt-4 rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Score breakdown with evidence</h2>
            <p className="mt-1 text-xs text-muted-foreground">Each criterion is backed by quotes pulled from the resume, intro pitch, and interview transcript.</p>
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

        <div className="mt-6 flex flex-wrap gap-2">
          {app.resume_url && <a href={app.resume_url} target="_blank" rel="noreferrer" className="glass inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm"><FileText className="h-4 w-4" /> Resume</a>}
          {app.intro_video_url && <a href={app.intro_video_url} target="_blank" rel="noreferrer" className="glass inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm"><Play className="h-4 w-4" /> Intro</a>}
          {app.interviews?.video_url && <a href={app.interviews.video_url} target="_blank" rel="noreferrer" className="glass inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm"><Play className="h-4 w-4" /> Interview recording</a>}
        </div>

        {app.intro_transcript && (
          <div className="glass mt-6 rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Intro pitch transcript</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{app.intro_transcript}</p>
          </div>
        )}

        {app.interviews?.transcript && app.interviews.transcript.length > 0 && (
          <div className="glass mt-4 rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Interview transcript</h2>
            <div className="mt-4 space-y-4">
              {app.interviews.transcript.map((t, i) => (
                <div key={i} className="rounded-2xl bg-secondary p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI</p>
                  <p className="mt-1 text-sm">{t.q}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Candidate</p>
                  <p className="mt-1 text-sm text-foreground/80">{t.a}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {app.interviews?.snapshots && app.interviews.snapshots.length > 0 && (
          <div className="glass mt-4 rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Proctoring snapshots</h2>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {app.interviews.snapshots.map((s, i) => <img key={i} src={s} alt="" className="aspect-video w-full rounded-xl object-cover" />)}
            </div>
            {app.interviews.flags && app.interviews.flags.length > 0 && (
              <div className="mt-4 rounded-2xl bg-destructive/10 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> {app.interviews.flags.length} integrity flag(s)</p>
                <ul className="mt-2 space-y-1 text-xs text-foreground/70">
                  {app.interviews.flags.map((f, i) => <li key={i}>• {f}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {app.audit_log?.length > 0 && (
          <div className="glass mt-4 rounded-3xl p-7">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold"><Clock className="h-4 w-4" /> Audit trail</h2>
            <ul className="mt-3 space-y-2 text-xs text-foreground/80">
              {app.audit_log.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                  <span className="capitalize">{e.action.replace(/_/g, " ")}{e.note ? ` — ${e.note}` : ""}</span>
                  <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
