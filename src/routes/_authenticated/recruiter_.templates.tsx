import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, orderBy, getDocs, getDoc, doc } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { upsertTemplate, deleteTemplate, attachQuestionToTemplate, detachQuestionFromTemplate } from "@/lib/templates.server";
import { ArrowLeft, Plus, Trash2, X, ListChecks } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recruiter_/templates")({
  component: TemplatesPage,
});

type Template = { id: string; name: string; description: string | null; rubric: Record<string, number>; created_at: string };
type Question = { id: string; text: string };
type TQ = { id: string; position: number; text_override: string | null; question_id: string | null; question_bank: { id: string; text: string } | null };

function TemplatesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const upsertFn = useServerFn(upsertTemplate);
  const deleteFn = useServerFn(deleteTemplate);
  const attachFn = useServerFn(attachQuestionToTemplate);
  const detachFn = useServerFn(detachQuestionFromTemplate);

  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: templates } = useQuery({
    queryKey: ["templates", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "interview_templates"),
        where("owner_id", "==", user!.id),
        orderBy("created_at", "desc"),
      ));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Template[];
    },
  });

  const save = useMutation({
    mutationFn: async () => upsertFn({ data: {
      id: editing?.id,
      name: editing?.name ?? "",
      description: editing?.description ?? undefined,
      rubric: editing?.rubric ?? { skills: 25, experience: 25, communication: 25, culture_fit: 25 },
    }}),
    onSuccess: () => { toast.success("Saved"); setEditing(null); qc.invalidateQueries({ queryKey: ["templates"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["templates"] }); if (openId) setOpenId(null); },
  });

  // questions for open template
  const { data: tqs } = useQuery({
    enabled: !!openId,
    queryKey: ["template-qs", openId],
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "interview_template_questions"),
        where("template_id", "==", openId!),
        orderBy("position", "asc"),
      ));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Omit<TQ, "question_bank">>;
      // Resolve linked question-bank text (the Supabase relational join, done manually).
      return Promise.all(rows.map(async (r) => {
        let question_bank: TQ["question_bank"] = null;
        if (r.question_id) {
          const qs = await getDoc(doc(db, "question_bank", r.question_id));
          if (qs.exists()) question_bank = { id: qs.id, text: (qs.data() as any).text };
        }
        return { ...r, question_bank } as TQ;
      }));
    },
  });

  const { data: bank } = useQuery({
    enabled: !!openId,
    queryKey: ["bank-for-attach", user?.id],
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "question_bank"),
        where("owner_id", "==", user!.id),
        orderBy("created_at", "desc"),
      ));
      return snap.docs.map((d) => ({ id: d.id, text: (d.data() as any).text })) as Question[];
    },
  });

  const attach = useMutation({
    mutationFn: async (vars: { questionId?: string; textOverride?: string }) => attachFn({ data: { templateId: openId!, ...vars } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["template-qs", openId] }),
  });
  const detach = useMutation({
    mutationFn: async (id: string) => detachFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["template-qs", openId] }),
  });

  function newRubricKey(rubric: Record<string, number>, key: string) {
    const r = { ...rubric };
    if (key && !(key in r)) r[key] = 10;
    return r;
  }

  function openNew() { setEditing({ name: "", description: "", rubric: { skills: 25, experience: 25, communication: 25, culture_fit: 25 } }); }
  const openTemplate = templates?.find((t) => t.id === openId);

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link to="/recruiter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Interview templates</h1>
            <p className="mt-1 text-sm text-muted-foreground">Bundle questions + rubric and reuse across roles.</p>
          </div>
          <button onClick={openNew} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="h-4 w-4" /> New template</button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {templates?.map((t) => (
            <div key={t.id} className="glass rounded-3xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold">{t.name}</h2>
                  {t.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
                </div>
                <button onClick={() => remove.mutate(t.id)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                {Object.entries(t.rubric ?? {}).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-secondary px-2 py-0.5 capitalize">{k.replace(/_/g, " ")} {v}%</span>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setOpenId(t.id)} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60"><ListChecks className="h-3.5 w-3.5" /> Manage questions</button>
                <button onClick={() => setEditing(t)} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60">Edit</button>
              </div>
            </div>
          ))}
          {(!templates || templates.length === 0) && <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground md:col-span-2">No templates yet.</div>}
        </div>
      </main>

      {editing && (
        <Editor editing={editing} setEditing={setEditing} save={save} newRubricKey={newRubricKey} />
      )}

      {openId && openTemplate && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={() => setOpenId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass-strong w-full max-w-2xl rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{openTemplate.name} — questions</h2>
              <button onClick={() => setOpenId(null)} className="rounded-full p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <ol className="mb-4 space-y-2">
              {tqs?.map((tq, i) => (
                <li key={tq.id} className="flex items-start gap-3 rounded-2xl bg-background/40 p-3 text-sm">
                  <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full bg-secondary text-xs">{i + 1}</span>
                  <p className="flex-1">{tq.text_override || tq.question_bank?.text || "(empty)"}</p>
                  <button onClick={() => detach.mutate(tq.id)} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
              {(!tqs || tqs.length === 0) && <p className="text-center text-xs text-muted-foreground">No questions yet — attach below.</p>}
            </ol>
            <AddInlineQuestion bank={bank ?? []} attach={(qid, text) => attach.mutate({ questionId: qid, textOverride: text })} />
          </div>
        </div>
      )}
    </div>
  );
}

function Editor({ editing, setEditing, save, newRubricKey }: { editing: Partial<Template>; setEditing: (v: Partial<Template> | null) => void; save: { isPending: boolean; mutate: () => void }; newRubricKey: (r: Record<string, number>, k: string) => Record<string, number> }) {
  const [newKey, setNewKey] = useState("");
  const rubric = editing.rubric ?? {};
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEditing(null)}>
      <div onClick={(e) => e.stopPropagation()} className="glass-strong w-full max-w-lg rounded-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{editing.id ? "Edit template" : "New template"}</h2>
          <button onClick={() => setEditing(null)} className="rounded-full p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Template name" className="w-full rounded-full border border-border bg-background/40 px-4 py-2.5 text-sm" />
          <textarea rows={2} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Description" className="w-full rounded-2xl border border-border bg-background/40 p-3 text-sm" />
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Rubric weights</p>
            <div className="space-y-2">
              {Object.entries(rubric).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-32 truncate text-sm capitalize">{k.replace(/_/g, " ")}</span>
                  <input type="range" min={0} max={100} value={v} onChange={(e) => setEditing({ ...editing, rubric: { ...rubric, [k]: Number(e.target.value) } })} className="flex-1" />
                  <span className="w-10 text-right text-xs text-muted-foreground">{v}%</span>
                  <button onClick={() => { const r = { ...rubric }; delete r[k]; setEditing({ ...editing, rubric: r }); }} className="rounded-full p-1 text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="add criterion (e.g. system_design)" className="flex-1 rounded-full border border-border bg-background/40 px-3 py-1.5 text-xs" />
              <button onClick={() => { if (newKey.trim()) { setEditing({ ...editing, rubric: newRubricKey(rubric, newKey.trim().toLowerCase().replace(/\s+/g, "_")) }); setNewKey(""); } }} className="rounded-full bg-secondary px-3 py-1.5 text-xs">Add</button>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="rounded-full bg-secondary px-4 py-2 text-sm">Cancel</button>
          <button disabled={save.isPending || !(editing.name ?? "").trim()} onClick={() => save.mutate()} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{save.isPending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function AddInlineQuestion({ bank, attach }: { bank: Question[]; attach: (questionId?: string, textOverride?: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="border-t border-border pt-4">
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Quick question text (override)" className="flex-1 rounded-full border border-border bg-background/40 px-4 py-2 text-sm" />
        <button disabled={!text.trim()} onClick={() => { attach(undefined, text); setText(""); }} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Add</button>
      </div>
      {bank.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">From bank</p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {bank.map((q) => (
              <button key={q.id} onClick={() => attach(q.id)} className="block w-full rounded-xl bg-background/40 p-2 text-left text-xs hover:bg-secondary/60">{q.text}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
