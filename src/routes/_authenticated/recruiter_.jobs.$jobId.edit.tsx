import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { db } from "@/integrations/firebase/client";
import { getDoc, doc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/recruiter_/jobs/$jobId/edit")({
  component: EditJob,
});

type Rubric = { skills: number; experience: number; communication: number; culture_fit: number };

function EditJob() {
  const { jobId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: job, isLoading } = useQuery({
    queryKey: ["job-edit", jobId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "jobs", jobId));
      return snap.exists() ? { id: snap.id, ...snap.data() } as any : null;
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ideal, setIdeal] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [interviewMode, setInterviewMode] = useState("async");
  const [salary, setSalary] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [rubric, setRubric] = useState<Rubric>({ skills: 25, experience: 25, communication: 25, culture_fit: 25 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (job) {
      setTitle(job.title || "");
      setDescription(job.description || "");
      setIdeal(job.ideal_profile || "");
      setLocation(job.location || "");
      setEmploymentType(job.employment_type || "full_time");
      setInterviewMode(job.interview_mode || "async");
      setSalary(job.salary_range || "");
      
      let parsedQuestions = [];
      try {
        parsedQuestions = typeof job.questions === 'string' ? JSON.parse(job.questions) : job.questions;
      } catch (e) {
        parsedQuestions = [];
      }
      setQuestions(Array.isArray(parsedQuestions) && parsedQuestions.length > 0 ? parsedQuestions : ["Tell us about a project you're proud of."]);
      
      let parsedRubric = { skills: 25, experience: 25, communication: 25, culture_fit: 25 };
      try {
        parsedRubric = typeof job.rubric === 'string' ? JSON.parse(job.rubric) : job.rubric;
      } catch (e) {}
      if (parsedRubric) setRubric(parsedRubric as Rubric);
    }
  }, [job]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", jobId), {
        title,
        description,
        ideal_profile: ideal,
        location,
        employment_type: employmentType as "full_time",
        interview_mode: interviewMode,
        salary_range: salary,
        questions: questions.filter((q) => q.trim()),
        rubric,
      });
      
      toast.success("Job updated");
      
      // Also update the feed post
      const q = query(collection(db, "posts"), where("job_id", "==", jobId));
      const postSnaps = await getDocs(q);
      for (const postSnap of postSnaps.docs) {
        await updateDoc(doc(db, "posts", postSnap.id), {
          title, 
          body: description.slice(0, 600) 
        });
      }
      
      navigate({ to: "/recruiter/jobs/$jobId", params: { jobId } });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally { setBusy(false); }
  }

  if (isLoading) return <div className="p-10 text-center">Loading...</div>;
  if (!job) return <div className="p-10 text-center">Job not found</div>;

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/recruiter/jobs/$jobId" params={{ jobId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to job
        </Link>
        <h1 className="font-display text-3xl font-bold tracking-tight">Edit job</h1>
        <p className="mt-2 text-sm text-muted-foreground">Update the job details, interview questions, or scoring rubric.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="glass-strong rounded-3xl p-7 space-y-4">
            <Field label="Job title"><input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Senior Product Designer" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder="Remote · NYC" /></Field>
              <Field label="Employment type">
                <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className="input">
                  <option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option>
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Salary range (optional)"><input value={salary} onChange={(e) => setSalary(e.target.value)} className="input" placeholder="$100k–$140k" /></Field>
              <Field label="Interview mode">
                <select value={interviewMode} onChange={(e) => setInterviewMode(e.target.value)} className="input">
                  <option value="async">Async (Recorded)</option>
                  <option value="live">Live (Real-time AI)</option>
                </select>
              </Field>
            </div>
            <Field label="Description"><textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className="input resize-none" placeholder="The role, what you'll do, what we offer…" /></Field>
            <Field label="Ideal candidate profile"><textarea value={ideal} onChange={(e) => setIdeal(e.target.value)} rows={5} className="input resize-none" placeholder="Skills, experience, qualities your perfect hire has." /></Field>
          </div>

          <div className="glass-strong rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Interview questions</h2>
            <p className="mt-1 text-xs text-muted-foreground">The AI will ask these plus a few personalized to each resume.</p>
            <div className="mt-4 space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <input value={q} onChange={(e) => setQuestions(questions.map((x, j) => j === i ? e.target.value : x))} className="input" placeholder={`Question ${i + 1}`} />
                  <button type="button" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} className="glass rounded-2xl px-3 hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setQuestions([...questions, ""])} className="glass inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm hover:bg-secondary/60"><Plus className="h-4 w-4" /> Add question</button>
            </div>
          </div>

          <div className="glass-strong rounded-3xl p-7">
            <h2 className="font-display text-lg font-semibold">Scoring rubric</h2>
            <p className="mt-1 text-xs text-muted-foreground">Weights total 100. We'll normalize if they don't.</p>
            <div className="mt-4 space-y-3">
              {(Object.keys(rubric) as (keyof Rubric)[]).map((k) => (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-xs"><span className="capitalize text-foreground">{k.replace("_", " ")}</span><span className="text-muted-foreground">{rubric[k]}%</span></div>
                  <input type="range" min={0} max={100} value={rubric[k]} onChange={(e) => setRubric({ ...rubric, [k]: Number(e.target.value) })} className="w-full" />
                </div>
              ))}
            </div>
          </div>

          <button disabled={busy} className="w-full rounded-2xl bg-primary px-4 py-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </form>
        <style>{`.input { width:100%; border-radius: 1rem; border: 1px solid var(--color-border); background: oklch(1 0 0 / 0.6); padding: 0.7rem 1rem; font-size: 0.875rem; outline: none; } .input:focus { border-color: oklch(0.12 0 0 / 0.3); }`}</style>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}
