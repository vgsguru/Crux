// Deterministic candidate ranking over the Redrob candidate schema. Pure functions
// so it can score thousands of candidates in the browser without any network call.

export type Requirement = {
  role: string;
  skills: string[];
  minYoe: number;
  location?: string;
  workMode?: string; // remote | hybrid | onsite
  keywords?: string; // free-text description of the role
};

export type Breakdown = { skills: number; role: number; experience: number; signals: number; fit: number };
export type Ranked = {
  candidate: any;
  score: number; // 0..1
  reason: string;
  breakdown: Breakdown;
  matchedSkills: string[];
};

const PROF: Record<string, number> = { beginner: 0.4, intermediate: 0.65, advanced: 0.85, expert: 1 };
const WEIGHTS = { skills: 0.35, role: 0.25, experience: 0.15, signals: 0.15, fit: 0.1 };
const STOP = new Set("the a an and or of to in for with on at is are be by we our you your as from that this role job".split(" "));

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const norm = (x: number, max: number) => clamp((x || 0) / max);

function tokenize(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0.5;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return clamp(hit / a.size);
}

function buildReason(c: any, matched: string[], s: any): string {
  const title = c.profile?.current_title || "Candidate";
  const yoe = Number(c.profile?.years_of_experience ?? 0).toFixed(1);
  const bits: string[] = [`${title} · ${yoe} yrs`];
  if (matched.length) bits.push(`${matched.length} matching skill${matched.length === 1 ? "" : "s"} (${matched.slice(0, 3).join(", ")})`);
  if (typeof s?.recruiter_response_rate === "number") bits.push(`response rate ${s.recruiter_response_rate.toFixed(2)}`);
  if (typeof s?.github_activity_score === "number" && s.github_activity_score > 40) bits.push(`GitHub ${Math.round(s.github_activity_score)}`);
  if (s?.open_to_work_flag) bits.push("open to work");
  return bits.join("; ") + ".";
}

export function scoreCandidate(c: any, req: Requirement, reqSkills: string[], kw: Set<string>): Ranked {
  const skillList: Array<{ n: string; s: any }> = (c.skills || []).map((s: any) => ({ n: (s.name || "").toLowerCase(), s }));
  const assess = c.redrob_signals?.skill_assessment_scores || {};

  // 1. Skill match
  const matched: string[] = [];
  let skillAcc = 0;
  for (const rs of reqSkills) {
    const hit = skillList.find((x) => x.n === rs || x.n.includes(rs) || rs.includes(x.n));
    if (hit) {
      matched.push(hit.s.name);
      const prof = PROF[hit.s.proficiency] ?? 0.5;
      const endorse = norm(hit.s.endorsements, 50);
      const a = norm(assess[hit.s.name], 100);
      skillAcc += 0.6 * prof + 0.2 * endorse + 0.2 * a;
    }
  }
  const skills = reqSkills.length ? clamp(skillAcc / reqSkills.length) : 0.5;

  // 2. Role / lexical relevance
  const hay = tokenize(
    `${c.profile?.headline || ""} ${c.profile?.summary || ""} ${c.profile?.current_title || ""} ${(c.career_history || []).map((h: any) => `${h.title || ""} ${h.description || ""}`).join(" ")} ${(c.skills || []).map((s: any) => s.name).join(" ")}`,
  );
  const role = overlap(kw, hay);

  // 3. Experience
  const yoe = Number(c.profile?.years_of_experience ?? 0);
  const experience = req.minYoe > 0
    ? yoe >= req.minYoe ? 1 - Math.min(0.25, (yoe - req.minYoe) / 40) : clamp((yoe / req.minYoe) * 0.85)
    : clamp(yoe / 10);

  // 4. Platform quality signals
  const s = c.redrob_signals || {};
  const signals = clamp(
    0.25 * (s.recruiter_response_rate ?? 0) +
      0.2 * (s.interview_completion_rate ?? 0) +
      0.15 * (s.offer_acceptance_rate ?? 0) +
      0.15 * norm(s.profile_completeness_score, 100) +
      0.1 * (s.open_to_work_flag ? 1 : 0) +
      0.1 * norm(s.saved_by_recruiters_30d, 20) +
      0.05 * (s.github_activity_score > 0 ? s.github_activity_score / 100 : 0),
  );

  // 5. Fit (location / work mode)
  let fit = 0.6;
  if (req.location) {
    fit = (c.profile?.location || "").toLowerCase().includes(req.location.toLowerCase()) ? 1 : s.willing_to_relocate ? 0.6 : 0.3;
  }
  if (req.workMode && s.preferred_work_mode) {
    fit = s.preferred_work_mode === req.workMode || s.preferred_work_mode === "flexible" ? Math.max(fit, 0.9) : Math.min(fit, 0.5);
  }

  const score = clamp(WEIGHTS.skills * skills + WEIGHTS.role * role + WEIGHTS.experience * experience + WEIGHTS.signals * signals + WEIGHTS.fit * fit);
  return { candidate: c, score, reason: buildReason(c, matched, s), breakdown: { skills, role, experience, signals, fit }, matchedSkills: matched };
}

export function rankCandidates(candidates: any[], req: Requirement, topN = 100): Ranked[] {
  const reqSkills = req.skills.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const kw = tokenize(`${req.role} ${req.keywords || ""} ${req.skills.join(" ")}`);
  const scored = candidates.map((c) => scoreCandidate(c, req, reqSkills, kw));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// Compact candidate profile for the LLM re-rank stage (only what matters, small tokens).
export function toCompact(c: any) {
  const s = c.redrob_signals || {};
  const topAssess = Object.entries(s.skill_assessment_scores || {})
    .sort((a: any, b: any) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k}:${Math.round(v as number)}`);
  return {
    id: c.candidate_id,
    title: c.profile?.current_title,
    yoe: c.profile?.years_of_experience,
    company: c.profile?.current_company,
    industry: c.profile?.current_industry,
    location: c.profile?.location,
    education: c.education?.[0] ? `${c.education[0].degree} ${c.education[0].field_of_study} (${c.education[0].tier})` : undefined,
    recent_roles: (c.career_history || []).slice(0, 3).map((h: any) => `${h.title} @ ${h.company} (${h.duration_months}mo)`),
    skills: (c.skills || []).slice(0, 14).map((x: any) => `${x.name}(${x.proficiency})`),
    summary: (c.profile?.summary || "").slice(0, 260),
    signals: {
      response_rate: s.recruiter_response_rate,
      interview_completion: s.interview_completion_rate,
      offer_acceptance: s.offer_acceptance_rate,
      profile_completeness: s.profile_completeness_score,
      github: s.github_activity_score,
      open_to_work: s.open_to_work_flag,
      assessments: topAssess,
    },
  };
}

// Merge the LLM re-rank scores (0-100) back over the stage-1 ranked list and re-sort.
export function mergeDeepScores(stage1: Ranked[], llm: Array<{ id: string; score: number; reason: string }>, topN = 100): Ranked[] {
  const map = new Map(llm.map((x) => [x.id, x]));
  return stage1
    .map((r) => {
      const l = map.get(r.candidate.candidate_id);
      if (!l) return r;
      const llmScore = clamp(l.score / 100);
      return { ...r, score: clamp(0.3 * r.score + 0.7 * llmScore), reason: l.reason || r.reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// Competition-format CSV: candidate_id,rank,score,reasoning
export function toSubmissionCsv(ranked: Ranked[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = ranked.map((r, i) => [r.candidate.candidate_id, String(i + 1), r.score.toFixed(4), esc(r.reason)].join(","));
  return ["candidate_id,rank,score,reasoning", ...rows].join("\n");
}
