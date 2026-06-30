#!/usr/bin/env node
/**
 * Cold-start seed: a few verified demo companies + jobs + feed posts so a brand-new
 * visitor never sees an empty feed/search. Idempotent (fixed doc ids).
 *   node scripts/seed-demo.cjs
 * Reads FIREBASE_SERVICE_ACCOUNT from .env. Remove later with: node scripts/reset-data.cjs
 */
const fs = require("fs");
const path = require("path");

function readEnv(key) {
  const txt = fs.readFileSync(path.resolve(__dirname, "..", ".env"), "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    return v;
  }
  return null;
}

const NOW = new Date().toISOString();
const REC = "demo-recruiter";

const COMPANIES = [
  { id: "demo-nimbus", name: "Nimbus AI", description: "We build retrieval-augmented assistants for Indian enterprises. Small team, big problems.", website: "https://example.com" },
  { id: "demo-forge", name: "Forge Labs", description: "Developer tooling and CI infrastructure. We care about fast feedback loops and clean abstractions.", website: "https://example.com" },
  { id: "demo-quanta", name: "Quanta Health", description: "Applied ML for diagnostics. Mission-driven, evidence-first.", website: "https://example.com" },
];

const JOBS = [
  { id: "demo-job-1", company: "demo-nimbus", title: "ML Engineer (LLM/RAG)", location: "Bengaluru · Hybrid", type: "full_time", salary: "₹18–32 LPA", desc: "Own our RAG pipeline end to end — chunking, embeddings, retrieval quality, and evals. You'll ship features that thousands of users hit daily.", ideal: "Strong Python, experience with vector DBs and LLM APIs, an eye for retrieval quality." },
  { id: "demo-job-2", company: "demo-nimbus", title: "Frontend Engineer (React)", location: "Remote · India", type: "full_time", salary: "₹14–24 LPA", desc: "Build a fast, polished product UI in React + TypeScript. You sweat the details of latency and interaction.", ideal: "React, TypeScript, strong product sense, accessibility awareness." },
  { id: "demo-job-3", company: "demo-forge", title: "Platform Engineer", location: "Pune · On-site", type: "full_time", salary: "₹20–36 LPA", desc: "Scale our build and CI infra. Kubernetes, observability, and developer experience are your playground.", ideal: "Go or Rust, Kubernetes, distributed systems fundamentals." },
  { id: "demo-job-4", company: "demo-forge", title: "Developer Advocate", location: "Remote", type: "contract", salary: "₹10–18 LPA", desc: "Write docs and demos developers actually love. Part teacher, part engineer.", ideal: "Great writing, real coding chops, community instincts." },
  { id: "demo-job-5", company: "demo-quanta", title: "Data Scientist (Health ML)", location: "Hyderabad · Hybrid", type: "full_time", salary: "₹16–28 LPA", desc: "Build and validate diagnostic models on clinical data. Rigorous evaluation and fairness are non-negotiable.", ideal: "Statistics, ML, healthcare data experience a plus, careful about bias." },
];

const RUBRIC = { skills: 30, experience: 25, communication: 25, culture_fit: 20 };
const QUESTIONS = ["Walk us through a project most relevant to this role.", "Describe a hard technical tradeoff you made and why.", "How do you validate that your work actually works?"];

(async () => {
  const sa = JSON.parse(readEnv("FIREBASE_SERVICE_ACCOUNT"));
  const { initializeApp, cert } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
  const db = getFirestore(app);

  await db.collection("users").doc(REC).set({ role: "recruiter", full_name: "Crux Demo Team" }, { merge: true });
  await db.collection("profiles").doc(REC).set({ full_name: "Crux Demo Team", username: "cruxdemo", bio: "Sample roles to explore Crux." }, { merge: true });
  await db.collection("usernames").doc("cruxdemo").set({ uid: REC, created_at: NOW }, { merge: true });

  for (const c of COMPANIES) {
    await db.collection("companies").doc(c.id).set({
      owner_id: REC, name: c.name, description: c.description, website: c.website,
      verification_status: "verified", logo_url: null, banner_url: null, created_at: NOW,
    }, { merge: true });
  }

  for (const j of JOBS) {
    await db.collection("jobs").doc(j.id).set({
      company_id: j.company, created_by: REC, created_at: NOW,
      title: j.title, description: j.desc, ideal_profile: j.ideal,
      location: j.location, employment_type: j.type, salary_range: j.salary,
      interview_mode: "async", questions: QUESTIONS, rubric: RUBRIC, status: "active",
      media_urls: [], moderation: { risk: 0, level: "ok", flags: [] },
    }, { merge: true });
    await db.collection("posts").doc("post-" + j.id).set({
      kind: "job", author_id: REC, company_id: j.company, job_id: j.id, created_at: NOW,
      title: j.title, body: j.desc.slice(0, 600), media_urls: [], tags: [j.type, j.location.split(" ")[0].toLowerCase()],
    }, { merge: true });
  }

  console.log(`Seeded ${COMPANIES.length} companies, ${JOBS.length} jobs + feed posts (owner: ${REC}).`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
