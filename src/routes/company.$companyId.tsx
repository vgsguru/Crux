import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/firebase/client";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { SiteNav } from "@/components/site-nav";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { FollowButton } from "@/components/follow-button";
import { Building2, Globe, Users, Briefcase, ArrowRight, MapPin } from "lucide-react";

export const Route = createFileRoute("/company/$companyId")({
  component: CompanyPage,
});

function CompanyPage() {
  const { companyId } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["company-public", companyId],
    queryFn: async () => {
      const cSnap = await getDoc(doc(db, "companies", companyId));
      if (!cSnap.exists()) return null;
      const company = { id: cSnap.id, ...cSnap.data() } as any;
      // Open jobs (equality-only; sort in JS).
      const jSnap = await getDocs(query(collection(db, "jobs"), where("company_id", "==", companyId)));
      const jobs = jSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as any)
        .filter((j) => j.status === "active")
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      // Follower count.
      const fSnap = await getDocs(query(collection(db, "follows"), where("company_id", "==", companyId)));
      return { company, jobs, followers: fSnap.size };
    },
  });

  if (isLoading) return <div className="bg-ambient min-h-screen"><SiteNav /><div className="p-20 text-center text-muted-foreground">Loading…</div></div>;
  if (!data) return <div className="bg-ambient min-h-screen"><SiteNav /><div className="p-20 text-center text-muted-foreground">Company not found.</div></div>;

  const { company, jobs, followers } = data;

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* Banner + header */}
        <div className="glass-strong overflow-hidden rounded-3xl">
          <div className="relative h-36 w-full bg-gradient-to-br from-primary/20 to-secondary sm:h-44">
            {company.banner_url && <img src={company.banner_url} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="px-6 pb-6">
            <div className="-mt-10 flex items-end justify-between gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-background bg-secondary">
                {company.logo_url ? <img src={company.logo_url} alt={company.name} className="h-full w-full object-cover" /> : <Building2 className="h-8 w-8 text-muted-foreground" />}
              </div>
              <FollowButton companyId={company.id} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <h1 className="font-display text-3xl font-bold tracking-tight">{company.name}</h1>
              <VerifiedBadge status={company.verification_status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {followers} follower{followers === 1 ? "" : "s"}</span>
              <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {jobs.length} open role{jobs.length === 1 ? "" : "s"}</span>
              {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-foreground"><Globe className="h-3.5 w-3.5" /> Website</a>}
            </div>
            {company.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{company.description}</p>}
          </div>
        </div>

        {/* Open roles */}
        <h2 className="mb-3 mt-8 font-display text-xl font-semibold">Open roles</h2>
        {jobs.length === 0 ? (
          <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground">No open roles right now. Follow to get notified when they post.</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => (
              <Link key={j.id} to="/jobs/$jobId" params={{ jobId: j.id }} className="glass flex items-center justify-between rounded-2xl px-5 py-4 hover:bg-secondary/40">
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold">{j.title}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {j.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{j.location}</span>}
                    {j.employment_type && <span className="capitalize">{String(j.employment_type).replace("_", " ")}</span>}
                    {j.salary_range && <span>{j.salary_range}</span>}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
