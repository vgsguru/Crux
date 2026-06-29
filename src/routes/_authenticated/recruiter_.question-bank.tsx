import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { upsertQuestion, deleteQuestion } from "@/lib/questionbank.server";
import { ArrowLeft, Plus, Trash2, Edit2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recruiter_/question-bank")({
  component: QuestionBank,
});

type Q = { id: string; text: string; expected_signal: string | null; tags: string[]; difficulty: "easy" | "medium" | "hard"; created_at: string };

function QuestionBank() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const upsertFn = useServerFn(upsertQuestion);
  const deleteFn = useServerFn(deleteQuestion);
  const [editing, setEditing] = useState<Partial<Q> | null>(null);
  const [tagsRaw, setTagsRaw] = useState("");

  const { data: questions } = useQuery({
    queryKey: ["question-bank", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "question_bank"),
        where("owner_id", "==", user!.id),
        orderBy("created_at", "desc"),
      ));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Q[];
    },
  });

  const save = useMutation({
    mutationFn: async () => upsertFn({ data: {
      id: editing?.id,
      text: editing?.text ?? "",
      expectedSignal: editing?.expected_signal ?? undefined,
      tags: tagsRaw.split(",").map((t) => t.trim()).filter(Boolean),
      difficulty: (editing?.difficulty ?? "medium") as "easy" | "medium" | "hard",
    }}),
    onSuccess: () => { toast.success("Question saved"); setEditing(null); setTagsRaw(""); qc.invalidateQueries({ queryKey: ["question-bank"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["question-bank"] }); },
  });

  function openNew() { setEditing({ text: "", expected_signal: "", difficulty: "medium" }); setTagsRaw(""); }
  function openEdit(q: Q) { setEditing(q); setTagsRaw(q.tags.join(", ")); }

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link to="/recruiter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Question bank</h1>
            <p className="mt-1 text-sm text-muted-foreground">Reusable interview questions you can drop into any template.</p>
          </div>
          <button onClick={openNew} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="h-4 w-4" /> New question</button>
        </div>

        <div className="mt-6 space-y-2">
          {(!questions || questions.length === 0) && <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground">No questions yet — add your first.</div>}
          {questions?.map((q) => (
            <div key={q.id} className="glass flex items-start justify-between gap-4 rounded-2xl p-5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{q.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full bg-secondary px-2 py-0.5 capitalize">{q.difficulty}</span>
                  {q.tags.map((t) => <span key={t} className="rounded-full bg-secondary px-2 py-0.5">#{t}</span>)}
                </div>
                {q.expected_signal && <p className="mt-2 text-xs text-muted-foreground">Looking for: {q.expected_signal}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(q)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => remove.mutate(q.id)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </main>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass-strong w-full max-w-lg rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{editing.id ? "Edit question" : "New question"}</h2>
              <button onClick={() => setEditing(null)} className="rounded-full p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Question</label>
                <textarea rows={3} value={editing.text ?? ""} onChange={(e) => setEditing({ ...editing, text: e.target.value })} className="mt-1 w-full rounded-2xl border border-border bg-background/40 p-3 text-sm" />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Expected signal (optional)</label>
                <textarea rows={2} value={editing.expected_signal ?? ""} onChange={(e) => setEditing({ ...editing, expected_signal: e.target.value })} className="mt-1 w-full rounded-2xl border border-border bg-background/40 p-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Tags (comma sep)</label>
                  <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} className="mt-1 w-full rounded-full border border-border bg-background/40 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Difficulty</label>
                  <select value={editing.difficulty ?? "medium"} onChange={(e) => setEditing({ ...editing, difficulty: e.target.value as "easy" | "medium" | "hard" })} className="mt-1 w-full rounded-full border border-border bg-background/40 px-3 py-2 text-sm">
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-full bg-secondary px-4 py-2 text-sm">Cancel</button>
              <button disabled={save.isPending || !(editing.text ?? "").trim()} onClick={() => save.mutate()} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{save.isPending ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
