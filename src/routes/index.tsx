import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteNav } from "@/components/site-nav";
import { Reveal } from "@/components/reveal";
import { motion } from "motion/react";
import { useAuth } from "@/hooks/use-auth";
import { recommendJobsForMe } from "@/lib/match.server";
import { ArrowRight, Briefcase, Camera, Sparkles, BarChart3, Wand2, ChevronDown, Mic, FileText, ShieldCheck, Users, UserCheck, MessageSquareText, Zap, ScanSearch, Check } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crux" },
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
        {/* Animated aurora backdrop */}
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <motion.div aria-hidden className="absolute -left-40 top-[12%] h-[30rem] w-[30rem] rounded-full bg-primary/10 blur-[150px]" animate={{ x: [0, 50, 0], y: [0, -40, 0] }} transition={{ duration: 19, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div aria-hidden className="absolute -right-40 top-[48%] h-[28rem] w-[28rem] rounded-full bg-indigo-400/10 blur-[150px]" animate={{ x: [0, -60, 0], y: [0, 50, 0] }} transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div aria-hidden className="absolute left-[40%] top-[78%] h-[24rem] w-[24rem] rounded-full bg-fuchsia-400/8 blur-[150px]" animate={{ x: [0, 40, 0], y: [0, -30, 0] }} transition={{ duration: 21, repeat: Infinity, ease: "easeInOut" }} />
        </div>

        {/* Hero Content now below the banner */}
        <section className="relative z-10 px-4 pb-20">
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
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              {[
                { icon: Zap, label: "Free to start" },
                { icon: Mic, label: "Live AI voice interview" },
                { icon: ShieldCheck, label: "Bias-blind & auditable" },
                { icon: BarChart3, label: "Ranked with evidence" },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Hero glass preview card */}
        <section className="relative z-10 px-4 pb-24">
          <div className="relative mx-auto max-w-5xl">
            <div className="glass-strong rounded-3xl p-2">
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { icon: FileText, title: "Apply in minutes", body: "Resume + a few screening answers. You get an instant AI report on your fit — no live interview to start." },
                  { icon: Mic, title: "Live AI voice interview", body: "Shortlisted candidates have a real spoken conversation with an AI that asks follow-ups. It can't be ghost-written." },
                  { icon: BarChart3, title: "Ranked, with evidence", body: "Every candidate scored against your rubric — each score backed by verbatim quotes. You only meet the top few." },
                ].map(({ icon: Icon, title, body }, i) => (
                  <Reveal key={title} delay={i * 0.1} className="h-full">
                    <motion.div whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} className="group glass h-full rounded-2xl p-5 transition-shadow duration-300 hover:shadow-[0_24px_60px_-24px_rgba(99,102,241,0.5)]">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                    </motion.div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="relative z-10 px-4 pb-24">
          <div className="mx-auto max-w-6xl">
            <Reveal className="mb-12 text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">How it works</span>
              <h2 className="mt-5 font-display text-3xl font-bold tracking-tight sm:text-4xl">From application to offer, intelligently</h2>
            </Reveal>
            <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* connecting line on desktop */}
              <div className="pointer-events-none absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent lg:block" />
              {[
                { n: "01", icon: FileText, title: "Apply", body: "Upload a resume, answer a few screening questions, attach a project." },
                { n: "02", icon: ScanSearch, title: "AI report", body: "Crux audits each application against the role and hands the recruiter a ranked report." },
                { n: "03", icon: Mic, title: "Live AI interview", body: "Shortlisted candidates have a spoken interview with dynamic follow-ups." },
                { n: "04", icon: BarChart3, title: "Decide", body: "Evidence-backed scores → the recruiter sends an offer or schedules a meeting." },
              ].map(({ n, icon: Icon, title, body }, i) => (
                <Reveal key={n} delay={i * 0.12}>
                  <motion.div whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 280, damping: 20 }} className="group glass relative h-full rounded-2xl p-6 transition-shadow duration-300 hover:shadow-[0_28px_70px_-28px_rgba(99,102,241,0.55)]">
                    <div className="flex items-center justify-between">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground ring-4 ring-background transition-transform duration-300 group-hover:scale-110"><Icon className="h-5 w-5" /></div>
                      <span className="font-display text-3xl font-bold text-foreground/10 transition-colors duration-300 group-hover:text-primary/30">{n}</span>
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                  </motion.div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Problems we fix — recruiters & applicants */}
        <section className="relative z-10 px-4 pb-24">
          <div className="mx-auto max-w-6xl">
            <Reveal className="mb-12 text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Hiring is broken on both sides</h2>
              <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">Crux fixes the same problem from two angles — so recruiters find real talent and applicants get a fair shot.</p>
            </Reveal>
            <div className="grid gap-6 lg:grid-cols-2">
              {[
                {
                  icon: Users, who: "For recruiters",
                  pairs: [
                    ["Drowning in inflated, keyword-stuffed resumes", "AI screens every applicant against your rubric and ranks them — best fits first."],
                    ["Answers that are ghost-written or AI-generated", "A live voice interview with dynamic follow-ups that can't be pre-scripted."],
                    ["Screening is slow and quietly biased", "Bias-blind scoring (no name, age, or gender) with a defensible audit trail."],
                    ["Fake companies and scam posts erode trust", "Company verification + automatic scam screening keep the marketplace clean."],
                  ],
                },
                {
                  icon: UserCheck, who: "For applicants",
                  pairs: [
                    ["Resumes rejected by keyword filters you never see", "Judged on a real conversation and your actual skills — not buzzwords."],
                    ["Applications vanish into silence, no feedback", "Every applicant gets an AI report: what's strong, what's missing, what to learn."],
                    ["A draining live interview for every single job", "One quick apply — you only interview if a recruiter shortlists you."],
                    ["No way to stand out beyond a PDF", "Attach real projects and earn a verified skill credential you own and reuse."],
                  ],
                },
              ].map(({ icon: Icon, who, pairs }, ci) => (
                <Reveal key={who} delay={ci * 0.12}>
                  <div className="glass-strong h-full rounded-3xl p-8">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground"><Icon className="h-5 w-5" /></div>
                      <h3 className="font-display text-xl font-bold">{who}</h3>
                    </div>
                    <div className="mt-6 space-y-3">
                      {pairs.map(([problem, fix]) => (
                        <div key={problem} className="rounded-2xl border border-transparent bg-secondary/40 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-secondary/70">
                          <p className="text-sm text-muted-foreground line-through decoration-destructive/40">{problem}</p>
                          <p className="mt-1.5 flex items-start gap-2 text-sm font-medium"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> <span>{fix}</span></p>
                        </div>
                      ))}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* For you */}
        {user && isApplicant && matches && matches.length > 0 && (
          <section className="relative z-10 px-4 pb-10">
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
                meinewelt-crux
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

        {/* Closing CTA */}
        <section className="relative z-10 px-4 py-24">
          <Reveal className="mx-auto max-w-4xl">
            <div className="group relative mx-auto overflow-hidden rounded-[2rem] glass-strong p-10 text-center sm:p-14">
            {/* sheen sweep on hover */}
            <div className="pointer-events-none absolute -inset-x-1/2 -top-1/2 h-[200%] w-[200%] -translate-x-full bg-gradient-to-r from-transparent via-primary/10 to-transparent transition-transform duration-1000 group-hover:translate-x-0" />
            <h2 className="relative font-display text-3xl font-bold tracking-tight sm:text-4xl">Ready to hire on signal, not noise?</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-muted-foreground">Whether you're hiring or job-hunting, Crux gets you to a real conversation faster. Free to start.</p>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to="/auth" className="glass-panel group inline-flex items-center gap-2 rounded-full bg-primary/80 px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.04] active:scale-[0.97]">
                Get started <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link to="/jobs" className="glass-panel inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-foreground/90 transition-transform hover:scale-[1.04] active:scale-[0.97]">
                Browse jobs
              </Link>
            </div>
            </div>
          </Reveal>
        </section>

        <footer className="border-t border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
          Crux · Built for hiring teams who care about every candidate.
        </footer>
      </div>
    </div>
  );
}
