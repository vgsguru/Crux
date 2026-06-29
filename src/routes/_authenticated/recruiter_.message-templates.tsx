import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { upsertMessageTemplate, deleteMessageTemplate, seedDefaultTemplates } from "@/lib/messaging.server";
import { ArrowLeft, Plus, Trash2, X, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recruiter_/message-templates")({
  component: MessageTemplates,
});

type MT = { id: string; name: string; kind: "invite" | "reject" | "next_steps" | "custom"; subject: string; body_md: string; created_at: string };

function MessageTemplates() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const upsertFn = useServerFn(upsertMessageTemplate);
  const deleteFn = useServerFn(deleteMessageTemplate);
  const seedFn = useServerFn(seedDefaultTemplates);
  const [editing, setEditing] = useState<Partial<MT> | null>(null);

  const { data: tpls } = useQuery({
    queryKey: ["message-templates", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "message_templates"),
        where("owner_id", "==", user!.id),
        orderBy("created_at", "desc"),
      ));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MT[];
    },
  });

  const save = useMutation({
    mutationFn: async () => upsertFn({ data: {
      id: editing?.id,
      name: editing?.name ?? "",
      kind: (editing?.kind ?? "custom") as MT["kind"],
      subject: editing?.subject ?? "",
      bodyMd: editing?.body_md ?? "",
    }}),
    onSuccess: () => { toast.success("Saved"); setEditing(null); qc.invalidateQueries({ queryKey: ["message-templates"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["message-templates"] }); },
  });
  const seed = useMutation({
    mutationFn: async () => seedFn({}),
    onSuccess: (r) => { toast.success(`Seeded ${(r as { seeded?: number }).seeded ?? 0} templates`); qc.invalidateQueries({ queryKey: ["message-templates"] }); },
  });

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link to="/recruiter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Message templates</h1>
            <p className="mt-1 text-sm text-muted-foreground">Use {`{{candidate_name}}`}, {`{{job_title}}`}, {`{{company_name}}`}, {`{{recruiter_name}}`} placeholders.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => seed.mutate()} className="glass inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs hover:bg-secondary/60"><Sparkles className="h-3.5 w-3.5" /> Seed defaults</button>
            <button onClick={() => setEditing({ name: "", kind: "custom", subject: "", body_md: "" })} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" /> New</button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {tpls?.map((t) => (
            <div key={t.id} className="glass rounded-3xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.kind}</p>
                  <h2 className="font-display text-base font-semibold">{t.name}</h2>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{t.subject}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(t)} className="rounded-full bg-secondary px-3 py-1 text-xs">Edit</button>
                  <button onClick={() => remove.mutate(t.id)} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-background/40 p-3 text-xs text-foreground/80">{t.body_md}</pre>
            </div>
          ))}
          {(!tpls || tpls.length === 0) && <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground md:col-span-2">No templates yet — seed defaults to start.</div>}
        </div>
      </main>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass-strong w-full max-w-xl rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{editing.id ? "Edit" : "New"} template</h2>
              <button onClick={() => setEditing(null)} className="rounded-full p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Name" className="rounded-full border border-border bg-background/40 px-4 py-2 text-sm" />
                <select value={editing.kind ?? "custom"} onChange={(e) => setEditing({ ...editing, kind: e.target.value as MT["kind"] })} className="rounded-full border border-border bg-background/40 px-3 py-2 text-sm">
                  <option value="invite">Invite</option>
                  <option value="next_steps">Next steps</option>
                  <option value="reject">Rejection</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <input value={editing.subject ?? ""} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="Subject (placeholders allowed)" className="w-full rounded-full border border-border bg-background/40 px-4 py-2 text-sm" />
              <textarea rows={10} value={editing.body_md ?? ""} onChange={(e) => setEditing({ ...editing, body_md: e.target.value })} placeholder="Body (markdown supported)" className="w-full rounded-2xl border border-border bg-background/40 p-3 text-sm" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-full bg-secondary px-4 py-2 text-sm">Cancel</button>
              <button disabled={save.isPending || !(editing.name ?? "").trim() || !(editing.subject ?? "").trim()} onClick={() => save.mutate()} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{save.isPending ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
