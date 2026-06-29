import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, getDocs, getDoc, doc, updateDoc, deleteDoc, orderBy } from "firebase/firestore";
import { SiteNav } from "@/components/site-nav";
import { setJobInterviewTemplate } from "@/lib/templates.server";
import { recommendCandidatesForJob } from "@/lib/match.server";
import { ArrowLeft, Award, FileText, Play, Columns, ListChecks, Pencil, Trash2, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recruiter_/jobs/$jobId")({
  component: JobApplicants,
});

type AppRow = {
  id: string;
  status: string;
  score: number | null;
  score_breakdown: Record<string, unknown> | null;
  ai_summary: string | null;
  resume_url: string | null;
  intro_video_url: string | null;
  created_at: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function JobApplicants() {
  const { jobId } = Route.useParams();
  const qc = useQueryClient();
  const setTplFn = useServerFn(setJobInterviewTemplate);

  const { data: job } = useQuery({
    queryKey: ["job-r", jobId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "jobs", jobId));
      return snap.exists() ? snap.data() as any : null;
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["templates-pick"],
    queryFn: async () => {
      const q = query(collection(db, "interview_templates"), orderBy("created_at", "desc"));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as any;
    },
  });

  const updateTpl = useMutation({
    mutationFn: async (vars: { templateId: string | null; mode: "async" | "live" }) => setTplFn({ data: { jobId, ...vars } }),
    onSuccess: () => { toast.success("Interview settings saved"); qc.invalidateQueries({ queryKey: ["job-r", jobId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const { data: applicants } = useQuery({
    queryKey: ["applicants", jobId],
    queryFn: async () => {
      // Equality-only query (no composite index needed); rank by score in JS.
      const q = query(collection(db, "applications"), where("job_id", "==", jobId));
      const snap = await getDocs(q);
      const apps = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      const profilePromises = apps.map(async (a: any) => {
        if (!a.applicant_id) return { ...a, profiles: null };
        const pSnap = await getDoc(doc(db, "profiles", a.applicant_id));
        return { ...a, profiles: pSnap.exists() ? pSnap.data() : null };
      });
      const list = (await Promise.all(profilePromises)) as unknown as AppRow[];
      return list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    },
  });

  // AI resume↔role match (independent of interview score — useful before interviews run).
  const recommendFn = useServerFn(recommendCandidatesForJob);
  const { data: matches } = useQuery({
    queryKey: ["job-candidate-matches", jobId],
    queryFn: async () => recommendFn({ data: { jobId, limit: 5 } }),
  });
  // applicant_id -> applicationId so each match links to its full review.
  const appIdByApplicant = new Map<string, string>();
  (applicants ?? []).forEach((a: any) => { if (a.applicant_id) appIdByApplicant.set(a.applicant_id, a.id); });

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link to="/recruiter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">{job?.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{applicants?.length ?? 0} applicants · ranked by AI score</p>
          </div>
          <div className="flex gap-2">
            <Link to="/recruiter/jobs/$jobId/pipeline" params={{ jobId }} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60"><Columns className="h-3.5 w-3.5" /> Pipeline</Link>
            <Link to="/recruiter/templates" className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60"><ListChecks className="h-3.5 w-3.5" /> Templates</Link>
            <Link to="/recruiter/jobs/$jobId/edit" params={{ jobId }} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60"><Pencil className="h-3.5 w-3.5" /> Edit</Link>
            <button onClick={async () => {
              if (confirm("Are you sure you want to close this job?")) {
                await updateDoc(doc(db, "jobs", jobId), { status: "closed" });
                // Pull it out of the feed too.
                const postsSnap = await getDocs(query(collection(db, "posts"), where("job_id", "==", jobId)));
                await Promise.all(postsSnap.docs.map((d) => deleteDoc(doc(db, "posts", d.id))));
                qc.invalidateQueries({ queryKey: ["job-r", jobId] });
                toast.success("Job closed and removed from the feed");
              }
            }} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /> Close</button>
          </div>
        </div>

        {job?.status === "pending_review" && (
          <div className="mt-4 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-700">
              <ListChecks className="h-4 w-4" /> This post is under review
            </p>
            <p className="mt-1 text-xs text-amber-700/80">
              Our spam filter flagged this post{Array.isArray(job?.moderation?.flags) && job.moderation.flags.length ? `: ${job.moderation.flags.join(", ")}` : ""}. It isn't shown publicly yet.
              {" "}Verify your company to publish instantly, or edit the post to remove the flagged content.
            </p>
          </div>
        )}

        <div className="glass mt-4 rounded-3xl p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Interview setup</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <select
              value={job?.interview_template_id ?? ""}
              onChange={(e) => updateTpl.mutate({ templateId: e.target.value || null, mode: (job?.interview_mode ?? "async") as "async" | "live" })}
              className="rounded-full border border-border bg-background/40 px-4 py-2 text-sm"
            >
              <option value="">No template — use AI-generated questions</option>
              {templates?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select
              value={job?.interview_mode ?? "async"}
              onChange={(e) => updateTpl.mutate({ templateId: job?.interview_template_id ?? null, mode: e.target.value as "async" | "live" })}
              className="rounded-full border border-border bg-background/40 px-4 py-2 text-sm"
            >
              <option value="async">Async video answers</option>
              <option value="live">Live AI interview</option>
            </select>
          </div>
        </div>

        {matches?.ready && matches.candidates.length > 0 && (
          <div className="glass-strong mt-4 rounded-3xl p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-foreground" />
              <p className="font-display text-sm font-semibold">AI top matches by resume</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Ranked by semantic similarity between each applicant's resume and this role — before interviews even run.</p>
            <div className="mt-4 space-y-2">
              {matches.candidates.map((c, i) => {
                const appId = appIdByApplicant.get(c.applicant_id);
                const pct = Math.round(c.similarity * 100);
                return (
                  <div key={c.applicant_id} className="flex items-center justify-between gap-3 rounded-2xl bg-background/40 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">{i + 1}</span>
                      <span className="truncate text-sm font-medium">{c.full_name || "Anonymous applicant"}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-secondary sm:block">
                        <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(4, pct)}%` }} />
                      </div>
                      <span className="w-10 text-right text-sm font-semibold tabular-nums">{pct}%</span>
                      {appId && (
                        <Link to="/recruiter/applications/$applicationId" params={{ applicationId: appId }} className="glass inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60">
                          Review <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {(!applicants || applicants.length === 0) ? (
            <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground">No applicants yet.</div>
          ) : applicants.map((a, idx) => (
            <div key={a.id} className="glass rounded-3xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground font-display text-sm font-semibold">#{idx + 1}</div>
                  <div>
                    <p className="font-display text-lg font-semibold">{a.profiles?.full_name || "Anonymous applicant"}</p>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{a.status.replace(/_/g, " ")}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-3xl font-bold">{a.score?.toFixed(0) ?? "—"}</div>
                  <p className="text-xs text-muted-foreground">/ 100</p>
                </div>
              </div>
              {a.ai_summary && <p className="mt-4 text-sm text-foreground/80">{a.ai_summary}</p>}
              {a.score_breakdown && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Object.entries(a.score_breakdown as Record<string, number>).map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-secondary px-3 py-2">
                      <p className="text-xs capitalize text-muted-foreground">{k.replace(/_/g, " ")}</p>
                      <p className="font-display text-sm font-semibold">{typeof v === "number" ? v.toFixed(0) : String(v)}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {a.resume_url && <a href={a.resume_url} target="_blank" rel="noreferrer" className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60"><FileText className="h-3.5 w-3.5" /> Resume</a>}
                {a.intro_video_url && <a href={a.intro_video_url} target="_blank" rel="noreferrer" className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60"><Play className="h-3.5 w-3.5" /> Intro video</a>}
                <Link to="/recruiter/applications/$applicationId" params={{ applicationId: a.id }} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60"><Award className="h-3.5 w-3.5" /> Full review</Link>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
