import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/firebase/client";
import {
  collection, query, where, getDocs, getDoc, doc,
  orderBy, limit
} from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { ensureUsername } from "@/lib/username";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight, Building2, Briefcase, Users, Plus, Star,
  Activity, ListChecks, Edit3, ExternalLink, Award,
  MapPin, Globe, CheckCircle2, Heart, MessageCircle, FileText, GraduationCap
} from "lucide-react";
import React from "react";

export const Route = createFileRoute("/_authenticated/profile/$userId")({
  component: ProfilePage,
});

/* ─── Route entry — detects role and delegates ─────────────────── */
function ProfilePage() {
  const { userId } = Route.useParams();
  return <ProfileResolver userId={userId} />;
}

// Reusable profile body — used by both /profile/$userId and the public /$username route.
export function ProfileResolver({ userId }: { userId: string }) {
  const { user } = useAuth();
  const isOwn = user?.id === userId;

  const { data: targetIsRecruiter, isLoading: roleLoading } = useQuery({
    queryKey: ["profile-role", userId],
    queryFn: async () => {
      const userDoc = await getDoc(doc(db, "users", userId));
      if (userDoc.exists()) {
        const r = userDoc.data()?.role;
        if (r === "recruiter" || (Array.isArray(r) && r.includes("recruiter"))) return true;
      }
      return false;
    },
  });

  if (roleLoading) {
    return (
      <div className="bg-ambient min-h-screen">
        <SiteNav />
        <div className="mx-auto max-w-5xl px-4 py-20 text-center">
          <div className="glass rounded-3xl p-10 animate-pulse text-muted-foreground">Loading profile…</div>
        </div>
      </div>
    );
  }

  return targetIsRecruiter
    ? <RecruiterProfile userId={userId} isOwn={isOwn} />
    : <ApplicantProfile userId={userId} isOwn={isOwn} />;
}

/* ─── RECRUITER PROFILE ────────────────────────────────────────── */
function RecruiterProfile({ userId, isOwn }: { userId: string; isOwn: boolean }) {

  const { data: company } = useQuery({
    queryKey: ["recruiter-profile-company", userId],
    queryFn: async () => {
      const q = query(collection(db, "companies"), where("owner_id", "==", userId));
      const snap = await getDocs(q);
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ["recruiter-profile-jobs", company?.id],
    enabled: !!company,
    queryFn: async () => {
      // Equality-only query (no composite index needed); filter active + sort in JS so
      // this always matches the recruiter dashboard's job list.
      const q = query(collection(db, "jobs"), where("company_id", "==", company!.id));
      const snap = await getDocs(q);
      const list: any[] = [];
      for (const d of snap.docs) {
        const job = { id: d.id, ...d.data() } as any;
        if (job.status && job.status !== "active") continue;
        const appSnap = await getDocs(query(collection(db, "applications"), where("job_id", "==", d.id)));
        job.applicantCount = appSnap.size;
        list.push(job);
      }
      return list
        .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
        .slice(0, 20);
    },
  });

  const { data: allApps } = useQuery({
    queryKey: ["recruiter-profile-apps", jobs?.map((j: any) => j.id)],
    enabled: !!jobs && jobs.length > 0,
    queryFn: async () => {
      const jobIds = (jobs as any[]).map(j => j.id);
      const chunks: string[][] = [];
      for (let i = 0; i < jobIds.length; i += 10) chunks.push(jobIds.slice(i, i + 10));
      const all: any[] = [];
      for (const chunk of chunks) {
        const snap = await getDocs(query(collection(db, "applications"), where("job_id", "in", chunk)));
        all.push(...snap.docs.map(d => d.data()));
      }
      return all;
    },
  });

  // Verified recruits (public trust signal) — confirmed recruitment claims.
  const { data: verifiedRecruits } = useQuery({
    queryKey: ["verified-recruits", userId],
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "recruitment_claims"),
        where("recruiter_id", "==", userId),
        where("status", "==", "approved"),
      ));
      return snap.size;
    },
  });

  const totalApps = allApps?.length ?? 0;
  const scored = allApps?.filter((a: any) => a.score != null) ?? [];
  const avgScore = scored.length
    ? Math.round(scored.reduce((s: number, a: any) => s + a.score, 0) / scored.length)
    : 0;

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">

        {/* Company Hero — banner band on top, logo overlapping, content on a solid panel */}
        <div className="overflow-hidden rounded-3xl border border-border/40 mb-8 glass-strong">
          <div className="relative h-40 w-full bg-gradient-to-br from-primary/30 via-indigo-400/20 to-secondary sm:h-56">
            {company?.banner_url && (
              <img src={company.banner_url} alt="" className="h-full w-full object-cover" />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-background/10 to-transparent" />
          </div>
          <div className="relative px-6 pb-6 sm:px-10 sm:pb-8">
            <div className="-mt-14 flex flex-col gap-5 sm:-mt-16 sm:flex-row sm:items-end">
              {company?.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-28 w-28 shrink-0 rounded-2xl border-4 border-background object-cover shadow-xl bg-background" />
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl border-4 border-background bg-gradient-to-br from-primary/20 to-primary/5 shadow-xl">
                  <Building2 className="h-11 w-11 text-primary" />
                </div>
              )}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-4xl font-bold tracking-tight">{company?.name ?? "Company"}</h1>
                {company?.verification_status === "verified" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                  </span>
                )}
                {!!verifiedRecruits && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground/80">
                    <Users className="h-3.5 w-3.5" /> {verifiedRecruits} verified {verifiedRecruits === 1 ? "recruit" : "recruits"}
                  </span>
                )}
              </div>
              {company?.description && (
                <p className="mt-2 text-sm text-muted-foreground max-w-2xl line-clamp-3">{company.description}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {company?.website && (
                  <a href={company.website} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-full bg-secondary/60 px-3 py-1.5 transition">
                    <Globe className="h-3.5 w-3.5" /> {company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                )}
                {isOwn && (
                  <>
                    <Link to="/recruiter/company"
                      className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-4 py-1.5 text-xs font-medium hover:bg-secondary transition">
                      <Edit3 className="h-3.5 w-3.5" /> Edit Company
                    </Link>
                    <Link to="/recruiter/jobs/new"
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition">
                      <Plus className="h-3.5 w-3.5" /> Post a Job
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Stats + quick links — own profile only */}
        {isOwn && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
              <StatCard icon={<Briefcase className="h-5 w-5" />} value={jobs?.length ?? 0} label="Active jobs" />
              <StatCard icon={<Users className="h-5 w-5" />} value={totalApps} label="Total applicants" />
              <StatCard icon={<Star className="h-5 w-5" />} value={avgScore > 0 ? `${avgScore}%` : "—"} label="Avg AI score" />
              <StatCard icon={<Activity className="h-5 w-5" />} value={scored.length} label="Scored interviews" />
            </div>
            <div className="flex flex-wrap gap-3 mb-10">
              <Link to="/recruiter" className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium hover:bg-secondary/80">
                <Activity className="h-4 w-4" /> Full Dashboard
              </Link>
              <Link to="/recruiter/templates" className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium hover:bg-secondary/80">
                <ListChecks className="h-4 w-4" /> Message Templates
              </Link>
            </div>
          </>
        )}

        {/* Active Jobs */}
        <h2 className="font-display text-2xl font-bold mb-4">Open Roles</h2>
        {!jobs || jobs.length === 0 ? (
          <div className="glass rounded-3xl p-10 text-center text-muted-foreground">
            {isOwn
              ? <><span>No active jobs. </span><Link to="/recruiter/jobs/new" className="text-foreground font-medium underline">Post your first role</Link>.</>
              : "No open roles right now."}
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((j: any) => (
              <Link key={j.id} to="/jobs/$jobId" params={{ jobId: j.id }}
                className="glass group flex items-center justify-between rounded-2xl px-6 py-5 hover:bg-secondary/30 transition">
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg font-semibold truncate">{j.title}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {j.location && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />{j.location}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground capitalize">{(j.employment_type ?? "full_time").replace("_", " ")}</span>
                    {isOwn && (
                      <span className="text-xs text-primary font-medium">
                        {j.applicantCount} applicant{j.applicantCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {isOwn && (
                    <Link to="/recruiter/jobs/$jobId/pipeline" params={{ jobId: j.id }}
                      onClick={e => e.stopPropagation()}
                      className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/70 transition">
                      Pipeline
                    </Link>
                  )}
                  <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Past Hires */}
        {company?.past_hires?.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl font-bold mb-4">Notable Hires</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {company.past_hires.map((hire: any) => (
                <a key={hire.id} href={hire.link || undefined} target="_blank" rel="noreferrer"
                  className="glass rounded-2xl p-5 hover:bg-secondary/30 transition flex items-center gap-4">
                  <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center font-bold text-primary shrink-0">
                    {hire.name?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{hire.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{hire.role}</p>
                  </div>
                  {hire.link && <ExternalLink className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />}
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="text-muted-foreground">{icon}</div>
      <p className="mt-3 font-display text-3xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

/* ─── Shared profile UI helpers ────────────────────────────────── */
function SectionHeader({ icon, title, count, subtitle }: { icon: React.ReactNode; title: string; count?: number; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5">
        {icon}
        <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
        {typeof count === "number" && count > 0 && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
        )}
      </div>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function HScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

function MediaCard({ image, fallback, title, subtitle }: { image?: string; fallback: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="glass-strong w-64 shrink-0 snap-start overflow-hidden rounded-3xl transition-transform hover:-translate-y-1">
      {image ? (
        <img src={image} alt={title} className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center bg-secondary/60 text-muted-foreground">{fallback}</div>
      )}
      <div className="p-4">
        <p className="font-display text-base font-semibold leading-tight line-clamp-2">{title}</p>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{subtitle}</p>}
      </div>
    </div>
  );
}

/* ─── APPLICANT PROFILE ────────────────────────────────────────── */
function ApplicantProfile({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["applicant-profile", userId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "profiles", userId));
      return snap.exists() ? { id: snap.id, ...snap.data() } as any : null;
    },
  });

  const { data: posts } = useQuery({
    queryKey: ["applicant-posts", userId],
    queryFn: async () => {
      const q = query(
        collection(db, "posts"),
        where("author_id", "==", userId),
        where("kind", "==", "showcase"),
        orderBy("created_at", "desc"),
        limit(20)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    },
  });

  // Portable proof-of-skill credentials earned from scored AI interviews.
  const { data: credentials } = useQuery({
    queryKey: ["applicant-credentials", userId],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "credentials"), where("user_id", "==", userId)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as any)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    },
  });

  const initials = (profile?.full_name ?? "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase();

  async function shareProfile() {
    try {
      const handle = profile?.username || await ensureUsername(userId, profile?.full_name ?? "");
      await navigator.clipboard.writeText(`${window.location.origin}/${handle}`);
      toast.success("Public profile link copied");
    } catch { toast.error("Couldn't generate your link"); }
  }

  const certs: any[] = Array.isArray(profile?.certificates) ? profile.certificates : [];
  const awards: any[] = Array.isArray(profile?.awards) ? profile.awards : [];
  const links: any[] = Array.isArray(profile?.links) ? profile.links : [];
  // Visibility toggles (owner always sees everything; others see only enabled sections).
  const vis: Record<string, boolean> = profile?.visibility ?? {};
  const show = (key: string) => isOwn || vis[key] !== false;

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-4xl px-4 py-10">
        {profileLoading ? (
          <div className="glass rounded-3xl p-10 text-center animate-pulse text-muted-foreground">Loading profile…</div>
        ) : (
          <div className="space-y-12">
            {/* ── Hero ──────────────────────────────────────────── */}
            <div className="glass-strong relative overflow-hidden rounded-[2rem] p-8 sm:p-10">
              <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative z-10 flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:text-left">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-28 w-28 shrink-0 rounded-full object-cover shadow-xl ring-4 ring-background/60" />
                ) : (
                  <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-secondary text-3xl font-bold shadow-xl ring-4 ring-background/60">{initials}</div>
                )}
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-4xl font-bold tracking-tight">{profile?.full_name || "Anonymous User"}</h1>
                  {profile?.headline && <p className="mt-1.5 text-lg font-medium text-foreground/80">{profile.headline}</p>}

                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    {profile?.location && show("location") && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {profile.location}</span>
                    )}
                    {credentials && credentials.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> {credentials.length} verified {credentials.length === 1 ? "assessment" : "assessments"}</span>
                    )}
                  </div>

                  {profile?.bio && <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">{profile.bio}</p>}
                  {!profile?.full_name && isOwn && (
                    <p className="mt-4 text-sm text-muted-foreground">Your profile is empty. Add details to stand out!</p>
                  )}

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    {isOwn ? (
                      <Link to="/me/profile" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                        <Edit3 className="h-4 w-4" /> {profile ? "Edit profile" : "Create profile"}
                      </Link>
                    ) : null}
                    <button onClick={shareProfile} className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-4 py-2 text-sm font-medium hover:bg-secondary">
                      <ExternalLink className="h-4 w-4" /> Share
                    </button>
                    {profile?.resume_url && show("resume") && (
                      <a href={profile.resume_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-4 py-2 text-sm font-medium hover:bg-secondary">
                        <FileText className="h-4 w-4" /> Résumé
                      </a>
                    )}
                    {links.map((link: any) => (
                      <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-4 py-2 text-sm hover:bg-secondary/60">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" /> {link.label || "Link"}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Verified assessments ──────────────────────────── */}
            {credentials && credentials.length > 0 && (
              <section>
                <SectionHeader icon={<CheckCircle2 className="h-5 w-5 text-primary" />} title="Verified assessments" count={credentials.length}
                  subtitle="Scores from AI interviews — personalized, proctored, and can't be ghost-written." />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {credentials.map((c) => (
                    <div key={c.id} className="glass-strong rounded-3xl p-6 transition-transform hover:-translate-y-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">{c.company_name ?? "Verified"}</p>
                          <h3 className="mt-1 font-display text-base font-semibold leading-tight line-clamp-2">{c.job_title}</h3>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"><CheckCircle2 className="h-3 w-3" /> Verified</span>
                      </div>
                      <div className="mt-4 flex items-end justify-between">
                        <div>
                          <span className="font-display text-4xl font-bold">{typeof c.score === "number" ? c.score.toFixed(0) : "—"}</span>
                          <span className="text-sm text-muted-foreground">/100</span>
                        </div>
                        {c.recommendation && <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] capitalize text-muted-foreground">{c.recommendation}</span>}
                      </div>
                      <p className="mt-3 text-[11px] text-muted-foreground">{c.mode === "live" ? "Live AI interview" : "Async AI interview"} · {c.created_at ? new Date(c.created_at).toLocaleDateString() : ""}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Education ─────────────────────────────────────── */}
            {show("education") && Array.isArray(profile?.education) && profile.education.length > 0 && (
              <section>
                <SectionHeader icon={<GraduationCap className="h-5 w-5 text-muted-foreground" />} title="Education" count={profile.education.length} />
                <div className="space-y-3">
                  {profile.education.map((ed: any, i: number) => (
                    <div key={ed.id ?? i} className="glass flex items-center gap-4 rounded-2xl p-4">
                      {ed.certificate ? (
                        <a href={ed.certificate} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={ed.certificate} alt="Certificate" className="h-16 w-16 rounded-xl object-cover ring-1 ring-border" />
                        </a>
                      ) : (
                        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-secondary/60 text-muted-foreground"><GraduationCap className="h-6 w-6" /></div>
                      )}
                      <div className="min-w-0">
                        <p className="font-display text-base font-semibold leading-tight">{ed.degree}{ed.field ? `, ${ed.field}` : ""}</p>
                        <p className="text-sm text-muted-foreground">{ed.institution}</p>
                        {(ed.start_year || ed.end_year) && <p className="text-xs text-muted-foreground">{[ed.start_year, ed.end_year].filter(Boolean).join(" – ")}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Certificates ──────────────────────────────────── */}
            {show("certificates") && certs.length > 0 && (
              <section>
                <SectionHeader icon={<Award className="h-5 w-5 text-muted-foreground" />} title="Certificates" count={certs.length} />
                <HScroll>
                  {certs.map((c: any, i: number) => (
                    <MediaCard key={c.id ?? i} image={c.image} fallback={<Award className="h-8 w-8" />} title={c.name} subtitle={c.issuer} />
                  ))}
                </HScroll>
              </section>
            )}

            {/* ── Awards ────────────────────────────────────────── */}
            {show("awards") && awards.length > 0 && (
              <section>
                <SectionHeader icon={<Star className="h-5 w-5 text-muted-foreground" />} title="Awards & prizes" count={awards.length} />
                <HScroll>
                  {awards.map((a: any, i: number) => (
                    <MediaCard key={a.id ?? i} image={a.image} fallback={<Star className="h-8 w-8" />} title={a.title} subtitle={a.description} />
                  ))}
                </HScroll>
              </section>
            )}

            {/* ── Showcase ──────────────────────────────────────── */}
            {show("showcase") && (
            <section>
              <SectionHeader icon={<Briefcase className="h-5 w-5 text-muted-foreground" />} title="Showcase" count={posts?.length ?? 0} />
              {!posts || posts.length === 0 ? (
                <div className="glass rounded-3xl p-12 text-center text-sm text-muted-foreground">
                  {isOwn ? "Share a project to showcase your work." : "No showcase posts yet."}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {posts.map(p => (
                    <div key={p.id} className="glass block rounded-3xl p-5 transition-transform hover:-translate-y-0.5">
                      <h3 className="font-display text-lg font-semibold line-clamp-1">{p.title}</h3>
                      {p.body && <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{p.body}</p>}
                      {p.media_urls?.length > 0 && (
                        <div className="mt-3 h-36 w-full overflow-hidden rounded-2xl">
                          <img src={p.media_urls[0]} alt="" className="h-full w-full object-cover" />
                        </div>
                      )}
                      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {p.like_count ?? 0}</span>
                        <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {p.comment_count ?? 0}</span>
                        <span className="ml-auto">{formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
