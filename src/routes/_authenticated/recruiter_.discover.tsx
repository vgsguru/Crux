import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiteNav } from "@/components/site-nav";
import { rankCandidates, toSubmissionCsv, toCompact, mergeDeepScores, type Requirement, type Ranked } from "@/lib/candidate-rank";
import { deepRankCandidates } from "@/lib/candidate-rank.server";
import { Upload, Search, Sparkles, Download, ArrowLeft, ChevronDown, Loader2, Users, MapPin, Star, Brain } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recruiter_/discover")({
  head: () => ({ meta: [{ title: "Talent Discovery · Crux" }] }),
  component: Discover,
});

function Discover() {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [deepRanking, setDeepRanking] = useState(false);
  const [aiRanked, setAiRanked] = useState(false);
  const [ranked, setRanked] = useState<Ranked[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [showN, setShowN] = useState(20);
  const deepRankFn = useServerFn(deepRankCandidates);

  const [role, setRole] = useState("");
  const [skills, setSkills] = useState("");
  const [minYoe, setMinYoe] = useState(0);
  const [location, setLocation] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [keywords, setKeywords] = useState("");

  async function loadFile(file: File) {
    setLoading(true);
    setRanked([]);
    try {
      const text = await file.text();
      const trimmed = text.trimStart();
      let list: any[];
      if (trimmed[0] === "[") {
        list = JSON.parse(text);
      } else {
        list = text.split(/\r?\n/).filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
      }
      list = list.filter((c) => c && c.candidate_id && c.profile);
      setCandidates(list);
      setFileName(file.name);
      toast.success(`Loaded ${list.length.toLocaleString()} candidates`);
    } catch (e: any) {
      toast.error("Couldn't parse that file — expected .json (array) or .jsonl");
    } finally { setLoading(false); }
  }

  function buildReq(): Requirement {
    return {
      role: role.trim(),
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      minYoe: Number(minYoe) || 0,
      location: location.trim() || undefined,
      workMode: workMode || undefined,
      keywords: keywords.trim() || undefined,
    };
  }
  function validate() {
    if (!candidates.length) { toast.error("Upload a candidate dataset first"); return false; }
    if (!role.trim() && !skills.trim()) { toast.error("Add a role or required skills"); return false; }
    return true;
  }

  // Stage 1 only — instant, in-browser, private.
  function runRank() {
    if (!validate()) return;
    setRanking(true);
    setTimeout(() => {
      try { setRanked(rankCandidates(candidates, buildReq(), 100)); setShowN(20); setAiRanked(false); }
      catch { toast.error("Ranking failed"); }
      finally { setRanking(false); }
    }, 30);
  }

  // Hybrid pipeline: stage-1 recall (top 150) → LLM understands the role & re-ranks with reasons.
  async function deepRank() {
    if (!validate()) return;
    setDeepRanking(true);
    try {
      const req = buildReq();
      const stage1 = rankCandidates(candidates, req, 150);
      const compact = stage1.map((r) => toCompact(r.candidate));
      const res = await deepRankFn({ data: { role: req.role, skills: req.skills, minYoe: req.minYoe, keywords: req.keywords, candidates: compact } }) as { scores: Array<{ id: string; score: number; reason: string }> };
      setRanked(mergeDeepScores(stage1, res.scores ?? [], 100));
      setShowN(20);
      setAiRanked(true);
      toast.success("AI-ranked shortlist ready");
    } catch (e: any) {
      toast.error(e?.message ?? "Deep rank failed");
    } finally { setDeepRanking(false); }
  }

  function exportCsv() {
    const csv = toSubmissionCsv(ranked);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ranking.csv";
    a.click();
  }

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link to="/recruiter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
        <div className="mt-3 flex items-center gap-2">
          <Search className="h-6 w-6" />
          <h1 className="font-display text-3xl font-bold tracking-tight">Talent Discovery</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Upload a candidate pool, describe the role, and get an evidence-ranked shortlist — each with a reason.</p>

        {/* Upload + requirements */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="glass-strong rounded-3xl p-6">
            <h2 className="font-display text-lg font-semibold">1 · Candidate dataset</h2>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center hover:border-foreground/30">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
              <span className="text-sm font-medium">{fileName || "Upload .json or .jsonl"}</span>
              <span className="text-xs text-muted-foreground">{candidates.length ? `${candidates.length.toLocaleString()} candidates loaded` : "Redrob candidate schema"}</span>
              <input type="file" accept=".json,.jsonl,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
            </label>
            <p className="mt-2 text-[11px] text-muted-foreground">Large files (100k+) may take a moment to parse in the browser.</p>
          </div>

          <div className="glass-strong rounded-3xl p-6">
            <h2 className="font-display text-lg font-semibold">2 · What you're hiring for</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Role / title" span><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior ML Engineer" className="inp" /></Field>
              <Field label="Must-have skills (comma-separated)" span><input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="python, pytorch, nlp, llm" className="inp" /></Field>
              <Field label="Min years experience"><input type="number" min={0} value={minYoe} onChange={(e) => setMinYoe(Number(e.target.value))} className="inp" /></Field>
              <Field label="Work mode"><select value={workMode} onChange={(e) => setWorkMode(e.target.value)} className="inp"><option value="">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option></select></Field>
              <Field label="Location (optional)"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bengaluru" className="inp" /></Field>
              <Field label="Extra context (optional)"><input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="fintech, startup, gen-ai" className="inp" /></Field>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button onClick={runRank} disabled={ranking || deepRanking || !candidates.length} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-sm font-medium hover:bg-secondary/70 disabled:opacity-50">
                {ranking ? <><Loader2 className="h-4 w-4 animate-spin" /> Ranking…</> : <><Sparkles className="h-4 w-4" /> Instant rank</>}
              </button>
              <button onClick={deepRank} disabled={ranking || deepRanking || !candidates.length} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {deepRanking ? <><Loader2 className="h-4 w-4 animate-spin" /> AI understanding role…</> : <><Brain className="h-4 w-4" /> Deep AI rank</>}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Instant = in-browser signals. Deep AI = the model reads the role's real intent and re-ranks the shortlist with reasons (~20–40s).</p>
          </div>
        </div>

        {/* Results */}
        {ranked.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold">Top matches <span className="text-sm font-normal text-muted-foreground">({ranked.length} ranked)</span>{aiRanked && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"><Brain className="h-3 w-3" /> AI-ranked</span>}</h2>
              <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/70"><Download className="h-4 w-4" /> Export top 100 CSV</button>
            </div>
            <div className="space-y-2">
              {ranked.slice(0, showN).map((r, i) => {
                const c = r.candidate;
                const isOpen = open === c.candidate_id;
                return (
                  <div key={c.candidate_id} className="glass rounded-2xl">
                    <button onClick={() => setOpen(isOpen ? null : c.candidate_id)} className="flex w-full items-center gap-4 p-4 text-left">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-sm font-bold text-background">{i + 1}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-base font-semibold">{c.profile?.current_title} <span className="text-sm font-normal text-muted-foreground">· {c.profile?.years_of_experience}y</span></p>
                        <p className="truncate text-xs text-muted-foreground">{r.reason}</p>
                        {r.matchedSkills.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.matchedSkills.slice(0, 6).map((s) => <span key={s} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{s}</span>)}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-display text-xl font-bold">{Math.round(r.score * 100)}<span className="text-xs text-muted-foreground">%</span></div>
                        <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition ${isOpen ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-border/60 px-4 py-4 text-sm">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Detail label="Headline" value={c.profile?.headline} />
                          <Detail label="Location" value={`${c.profile?.location || "—"}${c.profile?.country ? ", " + c.profile.country : ""}`} icon={<MapPin className="h-3 w-3" />} />
                          <Detail label="Current company" value={`${c.profile?.current_company || "—"} · ${c.profile?.current_industry || ""}`} />
                          <Detail label="Education" value={(c.education?.[0] ? `${c.education[0].degree}, ${c.education[0].field_of_study} (${c.education[0].tier})` : "—")} />
                        </div>
                        {c.profile?.summary && <p className="mt-3 text-foreground/80">{c.profile.summary}</p>}
                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {(Object.entries(r.breakdown) as [string, number][]).map(([k, v]) => (
                            <div key={k} className="rounded-xl bg-secondary/40 p-2 text-center">
                              <div className="font-display text-sm font-bold">{Math.round(v * 100)}%</div>
                              <div className="text-[10px] capitalize text-muted-foreground">{k}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" /> completeness {c.redrob_signals?.profile_completeness_score ?? "—"}%</span>
                          <span>resp {(c.redrob_signals?.recruiter_response_rate ?? 0).toFixed(2)}</span>
                          <span>interviews {(c.redrob_signals?.interview_completion_rate ?? 0).toFixed(2)}</span>
                          {c.redrob_signals?.open_to_work_flag && <span className="text-emerald-600">open to work</span>}
                          {c.redrob_signals?.verified_email && <span>✓ email</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {showN < ranked.length && (
              <button onClick={() => setShowN((n) => Math.min(n + 30, ranked.length))} className="mt-4 w-full rounded-2xl bg-secondary py-3 text-sm font-medium hover:bg-secondary/70">Show more ({ranked.length - showN} left)</button>
            )}
          </div>
        )}

        {!ranked.length && !candidates.length && (
          <div className="glass mt-8 rounded-3xl p-10 text-center text-sm text-muted-foreground">
            <Users className="mx-auto h-8 w-8" />
            <p className="mt-3">Upload a candidate dataset to begin. Ranking runs instantly in your browser — no data leaves your device.</p>
          </div>
        )}
      </main>
      <style>{`.inp{width:100%;border-radius:1rem;border:1px solid var(--color-border);background:oklch(1 0 0 / 0.5);padding:0.6rem 0.9rem;font-size:0.875rem;outline:none}.inp:focus{border-color:oklch(0.12 0 0 / 0.3)}`}</style>
    </div>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return <label className={`block ${span ? "sm:col-span-2" : ""}`}><span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}
function Detail({ label, value, icon }: { label: string; value?: string; icon?: React.ReactNode }) {
  return <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 flex items-center gap-1 text-foreground/85">{icon}{value || "—"}</p></div>;
}
