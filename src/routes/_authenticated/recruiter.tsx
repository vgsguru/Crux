import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, getDocs, updateDoc, doc, deleteDoc } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { ArrowRight, Building2, Briefcase, Users, Plus, Star, Activity, ListChecks, Database, FileText, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recruiter")({
  component: RecruiterDashboard,
});

function RecruiterDashboard() {
  const { user } = useAuth();
  const { data: company } = useQuery({
    queryKey: ["my-company", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const q = query(collection(db, "companies"), where("owner_id", "==", user!.id));
      const snap = await getDocs(q);
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ["my-jobs", company?.id],
    enabled: !!company,
    queryFn: async () => {
      // Equality-only query (no composite index needed); sort in JS.
      const q = query(collection(db, "jobs"), where("company_id", "==", company!.id));
      const snap = await getDocs(q);
      const fetchedJobs = await Promise.all(snap.docs.map(async (d) => {
        const jobData = { id: d.id, ...d.data() } as any;
        const appQ = query(collection(db, "applications"), where("job_id", "==", d.id));
        const appSnap = await getDocs(appQ);
        jobData.applications = [{ count: appSnap.size }];
        return jobData;
      }));
      return fetchedJobs.sort((a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
      );
    },
  });

  const { data: allApps } = useQuery({
    queryKey: ["all-apps-score", jobs?.map((j) => j.id)],
    enabled: !!jobs && jobs.length > 0,
    queryFn: async () => {
      if (jobs!.length === 0) return [];
      
      const chunks = [];
      const jobIds = jobs!.map((j) => j.id);
      for (let i = 0; i < jobIds.length; i += 10) {
        chunks.push(jobIds.slice(i, i + 10));
      }
      
      const allAppsData = [];
      for (const chunk of chunks) {
        const q = query(collection(db, "applications"), where("job_id", "in", chunk));
        const snap = await getDocs(q);
        allAppsData.push(...snap.docs.map(d => d.data()).filter(d => d.score != null));
      }
      
      return allAppsData as any[];
    },
  });

  const avgScore = allApps?.length ? Math.round(allApps.reduce((s, a) => s + (a.score ?? 0), 0) / allApps.length) : 0;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const scoredToday = allApps?.filter((a) => new Date(a.created_at) >= today).length ?? 0;

  const qc = useQueryClient();

  async function closeJob(jobId: string) {
    if (!confirm("Are you sure you want to close this job?")) return;
    await updateDoc(doc(db, "jobs", jobId), { status: "closed" });
    // Remove it from the feed too.
    const postsSnap = await getDocs(query(collection(db, "posts"), where("job_id", "==", jobId)));
    await Promise.all(postsSnap.docs.map((d) => deleteDoc(doc(db, "posts", d.id))));
    qc.invalidateQueries({ queryKey: ["my-jobs"] });
    toast.success("Job closed and removed from the feed");
  }

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Recruiter</p>
            <h1 className="mt-1 font-display text-4xl font-bold tracking-tight">{company?.name ?? "Welcome"}</h1>
          </div>
          {company && (
            <Link to="/recruiter/jobs/new" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> New job
            </Link>
          )}
        </div>

        {!company ? (
          <div className="glass-strong rounded-3xl p-10 text-center">
            <Building2 className="mx-auto h-8 w-8 text-foreground" />
            <h2 className="mt-4 font-display text-2xl font-semibold">Set up your company</h2>
            <p className="mt-2 text-sm text-muted-foreground">You need a company before you can post jobs.</p>
            <Link to="/recruiter/company" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              Create company <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/20 via-primary/5 to-background p-8 mb-8 border border-border/50">
              {company?.banner_url && (
                <>
                  <img src={company.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px]" />
                </>
              )}
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h2 className="font-display text-2xl font-bold">Dashboard Overview</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Here's how your hiring pipeline is performing across all roles.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link to="/recruiter/discover" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                    <Search className="h-4 w-4" /> Talent Discovery
                  </Link>
                  <Link to="/recruiter/templates" className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium hover:bg-secondary/80">
                    <ListChecks className="h-4 w-4" /> Message Templates
                  </Link>
                  <Link to="/recruiter/company" className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium hover:bg-secondary/80">
                    <Building2 className="h-4 w-4" /> Company Settings
                  </Link>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="glass rounded-2xl p-5 hover:bg-secondary/20 transition">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
                <p className="mt-3 font-display text-3xl font-semibold">{jobs?.filter(j => j.status === 'active').length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Active jobs</p>
              </div>
              <div className="glass rounded-2xl p-5 hover:bg-secondary/20 transition">
                <Users className="h-5 w-5 text-muted-foreground" />
                <p className="mt-3 font-display text-3xl font-semibold">{jobs?.reduce((s, j) => s + ((j.applications as unknown as { count: number }[])?.[0]?.count ?? 0), 0) ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total applicants</p>
              </div>
              <div className="glass rounded-2xl p-5 hover:bg-secondary/20 transition">
                <Star className="h-5 w-5 text-muted-foreground" />
                <p className="mt-3 font-display text-3xl font-semibold">{avgScore > 0 ? avgScore : "-"}</p>
                <p className="text-xs text-muted-foreground">Avg applicant score</p>
              </div>
              <div className="glass rounded-2xl p-5 hover:bg-secondary/20 transition">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <p className="mt-3 font-display text-3xl font-semibold">{scoredToday}</p>
                <p className="text-xs text-muted-foreground">Interviews scored today</p>
              </div>
            </div>

            <h2 className="mt-12 mb-4 font-display text-xl font-semibold">Active roles</h2>
            {(jobs ?? []).filter((j) => j.status === "active").length === 0 ? (
              <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground">
                No active jobs. <Link to="/recruiter/jobs/new" className="font-medium text-foreground underline">Post your first role</Link>.
              </div>
            ) : (
              <div className="space-y-3">
                {(jobs ?? []).filter((j) => j.status === "active").map((j) => (
                  <JobRow key={j.id} job={j} onClose={() => closeJob(j.id)} />
                ))}
              </div>
            )}

            {(jobs ?? []).some((j) => j.status !== "active") && (
              <>
                <h2 className="mt-10 mb-4 font-display text-xl font-semibold text-muted-foreground">Closed</h2>
                <div className="space-y-3 opacity-70">
                  {(jobs ?? []).filter((j) => j.status !== "active").map((j) => (
                    <JobRow key={j.id} job={j} closed />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function JobRow({ job, onClose, closed }: { job: any; onClose?: () => void; closed?: boolean }) {
  const count = (job.applications as unknown as { count: number }[])?.[0]?.count ?? 0;
  return (
    <div className="glass group flex items-center justify-between rounded-2xl px-6 py-4">
      <Link to="/recruiter/jobs/$jobId" params={{ jobId: job.id }} className="flex-1">
        <p className="font-display text-lg font-semibold">{job.title}</p>
        <p className="text-xs text-muted-foreground capitalize">
          <span className={job.status === "active" ? "text-primary font-medium" : ""}>{job.status}</span>
          {" · "}{count} applicants
        </p>
      </Link>
      <div className="flex items-center gap-2">
        <Link to="/recruiter/jobs/$jobId/pipeline" params={{ jobId: job.id }} className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/70">Pipeline</Link>
        <Link to="/recruiter/jobs/$jobId/edit" params={{ jobId: job.id }} className="rounded-full p-2 hover:bg-secondary"><ArrowRight className="h-4 w-4" /></Link>
        {!closed && onClose && (
          <button
            onClick={(e) => { e.preventDefault(); onClose(); }}
            className="rounded-full p-2 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
