import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteNav } from "@/components/site-nav";
import { useAuth } from "@/hooks/use-auth";
import { recommendJobsForMe } from "@/lib/match.server";
import { ArrowRight, Briefcase, Camera, Sparkles, BarChart3, Wand2, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crux — AI-powered hiring with live video interviews" },
      { name: "description", content: "Post jobs, run live AI video interviews, and rank applicants automatically. Built for fast, fair hiring." },
    ],
  }),
  component: Index,
});

type MatchRow = { id: string; title: string; company_id: string; similarity: number; is_saved: boolean };

const TEAM: Array<{ name: string; role: string; department: string; college: string; image: string }> = [
  { name: "Guru Sanjeeth", role: "Team Lead", department: "B.E. CSE (AI/ML)", college: "Vel Tech High Tech Engineering College", image: "/members/guru.jpg" },
  { name: "Hema Dheeksha", role: "Team Member", department: "B.E. CSE", college: "Vel Tech High Tech Engineering College", image: "/members/hema.jpg" },
  { name: "Harini Nadar", role: "Team Member", department: "B.E. CSE", college: "Vel Tech High Tech Engineering College", image: "/members/harini.jpg" },
];

function Index() {
  const { user, isApplicant } = useAuth();
  const recommendFn = useServerFn(recommendJobsForMe);

  const { data: matches } = useQuery({
    queryKey: ["home-matches", user?.id],
    enabled: !!user && isApplicant,
    queryFn: async () => {
      const res = await recommendFn({ data: { limit: 6 } });
      return res.matches as MatchRow[];
    },
  });

  return (
    <div className="bg-ambient min-h-screen relative">
      {/* Banner Video strictly at the top of the viewport */}
      <div data-nav-surface="dark" className="absolute inset-x-0 top-0 h-screen z-0 bg-black">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
        >
          <source src="/videos/Banner.mp4" type="video/mp4" />
        </video>
      </div>

      {/* Nav is globally sticky and z-40 so it stays above video and scrolling content */}
      <SiteNav />

      {/* Spacer to push content below the 100vh banner, plus a scroll indicator */}
      <div className="relative z-10 h-[calc(100vh-80px)] flex flex-col justify-end pb-12 pointer-events-none">
        <div className="flex justify-center animate-bounce">
          <div className="glass rounded-full p-2 text-foreground/80">
            <ChevronDown className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Rest of the page content */}
      <div className="relative z-20 bg-ambient pt-16">

        
        {/* Hero Content now below the banner */}
        <section className="px-4 pb-20">
          <div className="mx-auto max-w-5xl text-center">
            <div className="glass mx-auto inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-foreground/70">
              <Sparkles className="h-3.5 w-3.5" /> The AI hiring screen · built for AI/ML teams in India
            </div>
            <h1 className="mt-6 font-display text-5xl font-bold tracking-tight text-foreground sm:text-7xl">
              Resumes lie.
              <br />
              <span className="text-foreground/40">Interviews don't.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Crux replaces keyword-roulette screening with a live, personalized AI interview that can't be ghost-written.
              Every candidate is scored against your rubric with cited evidence — you get a ranked shortlist, not a pile of inflated profiles.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link to="/auth" className="glass-panel group inline-flex items-center gap-2 rounded-full bg-primary/80 px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.04] active:scale-[0.97]">
                <span className="relative z-10 inline-flex items-center gap-2">Get started <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
              </Link>
              <Link to="/jobs" className="glass-panel inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-foreground/90 transition-transform hover:scale-[1.04] active:scale-[0.97]">
                <span className="relative z-10">Browse open jobs</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Hero glass preview card */}
        <section className="px-4 pb-24">
          <div className="relative mx-auto max-w-5xl">
            <div className="glass-strong rounded-3xl p-2">
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { icon: Briefcase, title: "Apply, then prove it", body: "Resume + a 60-second pitch + short async answers. Low friction — no live interview to start." },
                  { icon: Camera, title: "Personalized AI interview", body: "Questions are generated from each candidate's own resume, so answers can't be ghost-written or pre-canned." },
                  { icon: BarChart3, title: "Ranked, with evidence", body: "Every candidate scored against your rubric — each score backed by verbatim quotes. You only meet the top few." },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="glass rounded-2xl p-5">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* For you */}
        {user && isApplicant && matches && matches.length > 0 && (
          <section className="px-4 pb-10">
            <div className="mx-auto max-w-6xl">
              <div className="mb-6 flex items-end justify-between">
                <div>
                  <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl flex items-center gap-2">
                    <Wand2 className="h-5 w-5" /> For you
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">Matched to your resume with semantic search.</p>
                </div>
                <Link to="/me/saved" className="text-sm underline text-muted-foreground hover:text-foreground">See all</Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {matches.slice(0, 6).map((m) => (
                  <Link key={m.id} to="/jobs/$jobId" params={{ jobId: m.id }} className="glass-strong group flex items-center justify-between gap-3 rounded-2xl p-4 hover:translate-y-[-1px] hover:shadow-lg">
                    <div className="min-w-0">
                      <p className="truncate font-display text-base font-semibold">{m.title}</p>
                      <p className="text-xs text-muted-foreground">{Math.round(m.similarity * 100)}% match{m.is_saved ? " · saved" : ""}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Our team — full-screen dark showcase with vertical glass cards */}
        <section data-nav-surface="dark" className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black px-4 py-24">
          {/* Ambient glow orbs */}
          <div className="pointer-events-none absolute -left-32 top-10 h-96 w-96 rounded-full bg-primary/20 blur-[120px]" />
          <div className="pointer-events-none absolute -right-24 bottom-10 h-96 w-96 rounded-full bg-indigo-500/20 blur-[120px]" />
          {/* Dotted grid texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.15]"
            style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)", backgroundSize: "26px 26px" }}
          />

          <div className="relative z-10 w-full max-w-6xl">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-white/70">
                The makers
              </span>
              <h2 className="mt-6 font-display text-5xl font-bold tracking-tight text-white sm:text-6xl">
                Our{" "}
                <span className="bg-gradient-to-r from-white via-white/80 to-white/40 bg-clip-text text-transparent">team</span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base text-white/55">The people building Crux.</p>
            </div>

            <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {TEAM.map((m) => {
                return (
                  <div
                    key={m.name}
                    className="group relative flex aspect-[3/4] flex-col overflow-hidden rounded-[2rem] border border-white/10 transition-all duration-300 hover:-translate-y-2 hover:border-white/25 hover:shadow-[0_30px_80px_-20px_rgba(99,102,241,0.45)]"
                  >
                    {/* Photo */}
                    <img
                      src={m.image}
                      alt={m.name}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover object-top grayscale transition-all duration-500 group-hover:grayscale-0 group-hover:scale-105"
                    />
                    {/* Bottom-up dark gradient for legible text */}
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/55 to-transparent" />
                    {/* top sheen */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

                    {/* Role badge */}
                    <span className="absolute left-5 top-5 rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-md">
                      {m.role}
                    </span>

                    <div className="relative mt-auto p-7">
                      <h3 className="font-display text-2xl font-bold text-white">{m.name}</h3>
                      <div className="mt-3 h-px w-12 bg-white/30 transition-all duration-300 group-hover:w-20" />
                      <p className="mt-3 text-sm font-medium text-white/85">{m.department}</p>
                      <p className="mt-1 text-xs uppercase tracking-wider text-white/55">{m.college}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <footer className="border-t border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
          Crux · Built for hiring teams who care about every candidate.
        </footer>
      </div>
    </div>
  );
}
