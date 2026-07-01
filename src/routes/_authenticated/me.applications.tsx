import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { ArrowRight, Briefcase } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/applications")({
  component: MyApplications,
});

function MyApplications() {
  const { user } = useAuth();
  const { data: apps } = useQuery({
    queryKey: ["my-apps", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Equality-only query (no composite index needed); sort in JS.
      const q = query(collection(db, "applications"), where("applicant_id", "==", user!.id));
      const snap = await getDocs(q);
      const applications = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[])
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

      for (const app of applications) {
        if (app.job_id) {
          const jobSnap = await getDoc(doc(db, "jobs", app.job_id));
          if (jobSnap.exists()) {
            const jobData = jobSnap.data();
            app.jobs = { id: jobSnap.id, title: jobData.title, companies: null };
            if (jobData.company_id) {
              const compSnap = await getDoc(doc(db, "companies", jobData.company_id));
              if (compSnap.exists()) {
                app.jobs.companies = { name: compSnap.data().name };
              }
            }
          }
        }
        
        const iQ = query(collection(db, "interviews"), where("application_id", "==", app.id));
        const iSnap = await getDocs(iQ);
        app.interviews = iSnap.docs.map(d => ({ id: d.id }));
      }

      return applications as unknown as Array<{
        id: string; status: string; score: number | null; created_at: string;
        retake_allowed: boolean; retake_count: number;
        jobs: { id: string; title: string; companies: { name: string } | null } | null;
        interviews: { id: string }[] | null;
      }>;
    },
  });

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">My applications</h1>
        <p className="mt-2 text-sm text-muted-foreground">Track every role you've applied to.</p>

        <div className="mt-6 space-y-3">
          {(!apps || apps.length === 0) ? (
            <div className="glass rounded-3xl p-10 text-center">
              <Briefcase className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No applications yet.</p>
              <Link to="/jobs" className="mt-4 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">Browse jobs</Link>
            </div>
          ) : apps.map((a) => {
            const jobId = a.jobs?.id;
            const STATUS_LABEL: Record<string, string> = {
              draft: "Draft — not submitted", applied: "Applied · under review",
              interview_invited: "Invited to interview", interview_in_progress: "Interview in progress",
              scored: "Reviewed", interview_complete: "Reviewed",
              offer_sent: "🎉 Offer received", meeting_proposed: "⏰ Pick a meeting time", meeting_scheduled: "Meeting scheduled", rejected: "Not selected",
            };
            const cta =
              a.status === "draft" && jobId ? { label: "Continue", to: "/apply/$jobId" as const, params: { jobId } }
              : a.status === "interview_invited" && jobId ? { label: "Take interview", to: "/apply/$jobId/interview" as const, params: { jobId } }
              : a.status === "interview_in_progress" && jobId ? { label: "Resume interview", to: "/apply/$jobId/interview" as const, params: { jobId } }
              : (a.status === "scored" || a.status === "interview_complete") ? { label: "View result", to: "/me/applications/$applicationId" as const, params: { applicationId: a.id } }
              : { label: "View", to: "/me/applications/$applicationId" as const, params: { applicationId: a.id } };
            const invited = a.status === "interview_invited" || a.status === "offer_sent" || a.status === "meeting_proposed";
            return (
              <div key={a.id} className="glass flex items-center justify-between rounded-3xl px-6 py-5">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{a.jobs?.companies?.name}</p>
                  <p className="mt-0.5 font-display text-lg font-semibold">{a.jobs?.title}</p>
                  <p className={`mt-1 text-xs ${invited ? "font-medium text-primary" : "text-muted-foreground"}`}>{STATUS_LABEL[a.status] ?? a.status.replace(/_/g, " ")}</p>
                </div>
                <div className="flex items-center gap-4">
                  {a.score != null && <div className="text-right"><div className="font-display text-2xl font-bold">{a.score.toFixed(0)}</div><p className="text-xs text-muted-foreground">/100</p></div>}
                  <Link to={cta.to} params={cta.params as any} className={`inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium ${invited ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-secondary text-foreground hover:bg-secondary/70"}`}>{cta.label} <ArrowRight className="h-4 w-4" /></Link>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

