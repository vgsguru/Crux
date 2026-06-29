import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { db } from "@/integrations/firebase/client";
import { getDoc, doc, collection, query, where, getDocs } from "firebase/firestore";
import { SiteNav } from "@/components/site-nav";
import { ArrowLeft, Award } from "lucide-react";

export const Route = createFileRoute("/_authenticated/recruiter_/jobs/$jobId/compare")({
  component: Compare,
  validateSearch: (s: Record<string, unknown>) => ({ ids: typeof s.ids === "string" ? s.ids : "" }),
});

type AppRow = {
  id: string;
  score: number | null;
  ai_summary: string | null;
  score_breakdown: Record<string, number> | null;
  ai_highlights: { strengths?: string[]; concerns?: string[]; recommendation?: string } | null;
  resume_match: { overall_pct?: number; matched_skills?: string[]; gaps?: string[] } | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function cellColor(v: number | undefined | null) {
  if (v == null) return "bg-secondary";
  if (v >= 80) return "bg-foreground text-background";
  if (v >= 60) return "bg-foreground/70 text-background";
  if (v >= 40) return "bg-foreground/40 text-background";
  if (v >= 20) return "bg-foreground/20";
  return "bg-foreground/10";
}

function Compare() {
  const { jobId } = Route.useParams();
  const { ids } = Route.useSearch();
  const idList = useMemo(() => ids.split(",").filter(Boolean).slice(0, 4), [ids]);

  const { data: job } = useQuery({
    queryKey: ["compare-job", jobId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "jobs", jobId));
      return snap.exists() ? snap.data() as { title: string; rubric: Record<string, number> } : null;
    },
  });

  const { data: apps } = useQuery({
    enabled: idList.length > 0,
    queryKey: ["compare-apps", idList.join(",")],
    queryFn: async () => {
      if (idList.length === 0) return [];
      const appPromises = idList.map(async (id) => {
        const snap = await getDoc(doc(db, "applications", id));
        if (!snap.exists()) return null;
        const data = { id: snap.id, ...snap.data() } as any;
        if (data.applicant_id) {
          const pSnap = await getDoc(doc(db, "profiles", data.applicant_id));
          data.profiles = pSnap.exists() ? pSnap.data() : null;
        } else {
          data.profiles = null;
        }
        return data;
      });
      const resolved = (await Promise.all(appPromises)).filter(Boolean);
      return resolved as unknown as AppRow[];
    },
  });

  const criteria = useMemo(() => {
    const keys = new Set<string>();
    Object.keys(job?.rubric ?? {}).forEach((k) => keys.add(k));
    (apps ?? []).forEach((a) => Object.keys(a.score_breakdown ?? {}).forEach((k) => keys.add(k)));
    return Array.from(keys);
  }, [job, apps]);

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-7xl px-4 py-10">
        <Link to="/recruiter/jobs/$jobId/pipeline" params={{ jobId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to pipeline</Link>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">{job?.title} — compare</h1>
        <p className="mt-1 text-sm text-muted-foreground">Side-by-side rubric heatmap. Up to 4 candidates.</p>

        {idList.length === 0 && <div className="glass mt-6 rounded-3xl p-10 text-center text-sm text-muted-foreground">No candidates selected. Go back to the pipeline and pick up to 4.</div>}

        {apps && apps.length > 0 && (
          <div className="glass mt-6 overflow-x-auto rounded-3xl p-4">
            <table className="w-full min-w-[640px] border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground">Criterion</th>
                  {apps.map((a) => (
                    <th key={a.id} className="text-left text-xs">
                      <Link to="/recruiter/applications/$applicationId" params={{ applicationId: a.id }} className="hover:underline">
                        <p className="font-display text-sm font-semibold">{a.profiles?.full_name || "Anonymous"}</p>
                        <p className="text-xs text-muted-foreground">{a.score?.toFixed(0) ?? "—"}/100 overall</p>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {criteria.map((c) => (
                  <tr key={c}>
                    <td className="pr-3 text-sm capitalize text-foreground/80">{c.replace(/_/g, " ")}</td>
                    {apps.map((a) => {
                      const v = a.score_breakdown?.[c];
                      return (
                        <td key={a.id} className={`rounded-xl px-3 py-2 text-center text-sm font-semibold ${cellColor(v)}`}>{typeof v === "number" ? v.toFixed(0) : "—"}</td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="pr-3 pt-3 text-xs uppercase tracking-wider text-muted-foreground">Resume match</td>
                  {apps.map((a) => (
                    <td key={a.id} className={`rounded-xl px-3 py-2 pt-3 text-center text-sm font-semibold ${cellColor(a.resume_match?.overall_pct)}`}>{a.resume_match?.overall_pct != null ? `${a.resume_match.overall_pct.toFixed(0)}%` : "—"}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {apps && apps.length > 0 && (
          <div className="mt-6 grid gap-3" style={{ gridTemplateColumns: `repeat(${apps.length}, minmax(0, 1fr))` }}>
            {apps.map((a) => (
              <div key={a.id} className="glass rounded-3xl p-5">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-muted-foreground" />
                  <p className="font-display text-sm font-semibold">{a.profiles?.full_name || "Anonymous"}</p>
                </div>
                {a.ai_highlights?.recommendation && <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{a.ai_highlights.recommendation}</p>}
                {a.ai_summary && <p className="mt-2 text-xs text-foreground/80">{a.ai_summary}</p>}
                {a.ai_highlights?.strengths && a.ai_highlights.strengths.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Strengths</p>
                    <ul className="mt-1 space-y-1 text-xs">{a.ai_highlights.strengths.slice(0, 3).map((s, i) => <li key={i}>• {s}</li>)}</ul>
                  </div>
                )}
                {a.ai_highlights?.concerns && a.ai_highlights.concerns.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Concerns</p>
                    <ul className="mt-1 space-y-1 text-xs">{a.ai_highlights.concerns.slice(0, 3).map((s, i) => <li key={i}>• {s}</li>)}</ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
