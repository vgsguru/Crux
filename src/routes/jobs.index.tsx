import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/firebase/client";
import { collection, doc, getDoc, getDocs, query, where, limit } from "firebase/firestore";
import { SiteNav } from "@/components/site-nav";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { ArrowRight, Briefcase, MapPin, Search } from "lucide-react";

export const Route = createFileRoute("/jobs/")({
  component: JobsFeed,
});

type JobRow = {
  id: string;
  title: string;
  location: string | null;
  employment_type: string | null;
  created_at: string;
  companies: { name: string; logo_url: string | null; verification_status: string | null } | null;
};

function JobsFeed() {
  const { user } = useAuth();
  const { data: myLocation } = useQuery({
    queryKey: ["my-location", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const snap = await getDoc(doc(db, "profiles", user!.id));
      return snap.exists() ? ((snap.data() as any).location as string | null) : null;
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ["public-jobs"],
    queryFn: async () => {
      const jobsQuery = query(
        collection(db, "jobs"),
        where("status", "==", "active"),
        limit(100)
      );
      const jobsSnap = await getDocs(jobsQuery);
      
      const jobsData = [];
      for (const d of jobsSnap.docs) {
        const job = { id: d.id, ...d.data() } as any;
        if (job.company_id) {
          const compSnap = await getDoc(doc(db, "companies", job.company_id));
          job.companies = compSnap.exists() ? { id: compSnap.id, ...compSnap.data() } : null;
        } else {
          job.companies = null;
        }
        jobsData.push(job);
      }
      
      // Verified companies rank first (trust signal), then newest.
      jobsData.sort((a, b) => {
        const va = a.companies?.verification_status === "verified" ? 1 : 0;
        const vb = b.companies?.verification_status === "verified" ? 1 : 0;
        if (va !== vb) return vb - va;
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });

      return jobsData as unknown as JobRow[];
    },
  });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);

  // Location tokens for proximity ranking (optional — only if the viewer set a location).
  const locTokens = (myLocation ?? "").toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2);
  const nearMe = (j: JobRow) => locTokens.length > 0 && !!j.location && locTokens.some((t) => j.location!.toLowerCase().includes(t));

  const filtered = (jobs ?? []).filter((j) => {
    const matchesSearch = !search || j.title.toLowerCase().includes(search.toLowerCase()) || (j.companies?.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || j.employment_type === typeFilter;
    return matchesSearch && matchesType;
  });
  // Stable sort: roles near the viewer first, preserving the verified+recent order within groups.
  const ranked = [...filtered].sort((a, b) => (nearMe(b) ? 1 : 0) - (nearMe(a) ? 1 : 0));
  const visibleJobs = ranked.slice(0, (page + 1) * 9);

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />

      <section className="px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">Open roles</h1>
              <p className="mt-2 text-sm text-muted-foreground">Find your next opportunity and apply with a live AI interview.</p>
            </div>
          </div>
          
          <div className="mb-8 space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by role or company..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="w-full rounded-full border border-border bg-background/60 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-foreground/30"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "all", label: "All roles" },
                { id: "full_time", label: "Full-time" },
                { id: "part_time", label: "Part-time" },
                { id: "contract", label: "Contract" },
                { id: "internship", label: "Internship" }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => { setTypeFilter(f.id); setPage(0); }}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${typeFilter === f.id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-secondary/70"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {(!visibleJobs || visibleJobs.length === 0) ? (
            <div className="glass rounded-3xl px-8 py-16 text-center">
              <Briefcase className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-4 font-display text-lg font-semibold">No open roles found</p>
              <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters.</p>
            </div>
          ) : (
            <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleJobs.map((job) => (
                <Link
                  key={job.id}
                  to="/jobs/$jobId"
                  params={{ jobId: job.id }}
                  className="glass group relative flex flex-col rounded-3xl p-6 transition hover:translate-y-[-2px] hover:shadow-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/5 text-foreground">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        {job.companies?.name ?? "Company"}
                        <VerifiedBadge status={job.companies?.verification_status} />
                      </p>
                    </div>

                  </div>
                  <h3 className="mt-4 font-display text-xl font-semibold leading-tight">{job.title}</h3>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {job.location && (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${nearMe(job) ? "bg-primary/10 text-primary font-medium" : "bg-secondary"}`}>
                        <MapPin className="h-3 w-3" /> {job.location}{nearMe(job) ? " · Near you" : ""}
                      </span>
                    )}
                    {job.employment_type && (
                      <span className="rounded-full bg-secondary px-2.5 py-1 capitalize">{job.employment_type.replace("_", " ")}</span>
                    )}
                  </div>
                  <div className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-foreground">
                    View role <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
            {filtered.length > (page + 1) * 9 && (
              <div className="mt-10 flex justify-center">
                <button 
                  onClick={() => setPage(p => p + 1)}
                  className="rounded-full border border-border bg-background px-6 py-2.5 text-sm font-medium hover:bg-secondary/60 transition"
                >
                  Load more
                </button>
              </div>
            )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
