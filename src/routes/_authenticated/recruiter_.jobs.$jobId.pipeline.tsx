import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import React, { useMemo, useState } from "react";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, getDocs, getDoc, doc, orderBy } from "firebase/firestore";
import { SiteNav } from "@/components/site-nav";
import { setPipelineStage } from "@/lib/ai.server";
import { bulkUpdateApplicationStage } from "@/lib/match.server";
import { bulkNotify } from "@/lib/messaging.server";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { ArrowLeft, CheckSquare, Square as SquareIcon, X, Mail, Columns, Star } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recruiter_/jobs/$jobId/pipeline")({
  component: Pipeline,
});

type Stage = "applied" | "interviewed" | "shortlisted" | "offer" | "rejected";
const STAGES: { id: Stage; label: string; color: string }[] = [
  { id: "applied", label: "Applied", color: "bg-blue-500/10 text-blue-600 border-blue-200" },
  { id: "interviewed", label: "Interviewed", color: "bg-purple-500/10 text-purple-600 border-purple-200" },
  { id: "shortlisted", label: "Shortlisted", color: "bg-amber-500/10 text-amber-600 border-amber-200" },
  { id: "offer", label: "Offer", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
  { id: "rejected", label: "Rejected", color: "bg-red-500/10 text-red-600 border-red-200" },
];

type AppRow = {
  id: string;
  score: number | null;
  ai_summary: string | null;
  pipeline_status: Stage;
  profiles: { full_name: string | null } | null;
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">No score</span>;
  const color = score >= 75 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-500";
  return <span className={`text-xs font-bold tabular-nums ${color}`}>{score.toFixed(0)}/100</span>;
}

function Pipeline() {
  const { jobId } = Route.useParams();
  const qc = useQueryClient();
  const setStageFn = useServerFn(setPipelineStage);
  const navigate = useNavigate();

  const { data: job } = useQuery({
    queryKey: ["job-pipeline-meta", jobId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "jobs", jobId));
      return snap.exists() ? snap.data() as any : null;
    },
  });

  const { data: apps = [] } = useQuery({
    queryKey: ["pipeline", jobId],
    queryFn: async () => {
      const q = query(collection(db, "applications"), where("job_id", "==", jobId));
      const snap = await getDocs(q);
      const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const withProfiles = await Promise.all(raw.map(async (a: any) => {
        if (!a.applicant_id) return { ...a, profiles: null };
        const pSnap = await getDoc(doc(db, "profiles", a.applicant_id));
        return { ...a, profiles: pSnap.exists() ? pSnap.data() : null };
      }));
      return (withProfiles as AppRow[]).sort((a: any, b: any) => (b.score ?? -1) - (a.score ?? -1));
    },
  });

  // Local stage state for optimistic DnD rendering
  const [localStages, setLocalStages] = useState<Record<string, Stage>>({});

  const effectiveApps = apps.map(a => ({
    ...a,
    pipeline_status: localStages[a.id] ?? a.pipeline_status,
  }));

  const move = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) => setStageFn({ data: { applicationId: id, stage } }),
    onSuccess: (_d, { id }) => {
      // Remove from local optimistic once server confirms
      setLocalStages(prev => { const n = { ...prev }; delete n[id]; return n; });
      qc.invalidateQueries({ queryKey: ["pipeline", jobId] });
      toast.success("Stage updated");
    },
    onError: (e, { id }) => {
      // Revert
      setLocalStages(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.error(e instanceof Error ? e.message : "Failed");
    },
  });

  function onDragEnd(result: any) {
    if (!result.destination) return;
    const { draggableId: id, destination } = result;
    const stage = destination.droppableId as Stage;
    const app = effectiveApps.find(a => a.id === id);
    if (!app || app.pipeline_status === stage) return;
    // Optimistic update
    setLocalStages(prev => ({ ...prev, [id]: stage }));
    move.mutate({ id, stage });
  }

  const bulkFn = useServerFn(bulkUpdateApplicationStage);
  const notifyFn = useServerFn(bulkNotify);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allIds = useMemo(() => new Set(effectiveApps.map(a => a.id)), [apps]);
  const [notifyOpen, setNotifyOpen] = useState(false);

  const bulk = useMutation({
    mutationFn: async (stage: Stage) => bulkFn({ data: { applicationIds: Array.from(selected), stage } }),
    onSuccess: (_d, stage) => {
      toast.success(`Moved ${selected.size} to ${stage}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["pipeline", jobId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Bulk update failed"),
  });

  type Tpl = { id: string; name: string; subject: string; body_md: string };
  const { data: msgTpls } = useQuery({
    queryKey: ["msg-tpls-pipeline"],
    queryFn: async () => {
      const q = query(collection(db, "message_templates"), orderBy("created_at", "desc"));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as Tpl[] | null;
    },
  });
  const [chosenTplId, setChosenTplId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [channel, setChannel] = useState<"email" | "inapp" | "both">("both");

  function applyTpl(id: string) {
    setChosenTplId(id);
    const t = (msgTpls ?? []).find((x) => x.id === id);
    if (t) { setSubject(t.subject); setBodyMd(t.body_md); }
  }

  const notify = useMutation({
    mutationFn: async () => notifyFn({ data: {
      applicationIds: Array.from(selected),
      channel,
      templateId: chosenTplId || undefined,
      subject: subject || undefined,
      bodyMd: bodyMd || undefined,
    }}),
    onSuccess: (r) => {
      const res = r as { total: number; sent: number; errors: number };
      toast.success(`Notified ${res.total} candidates`);
      setNotifyOpen(false); setSelected(new Set());
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Notify failed"),
  });

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openCompare() {
    if (selected.size < 2) return;
    navigate({ to: "/recruiter/jobs/$jobId/compare", params: { jobId }, search: { ids: Array.from(selected).slice(0, 4).join(",") } });
  }

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-[1400px] px-4 py-8 pb-32">
        <Link to="/recruiter/jobs/$jobId" params={{ jobId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to applicants
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">{job?.title} — pipeline</h1>
            <p className="mt-1 text-sm text-muted-foreground">Drag candidates between stages to update their status.</p>
          </div>
          <button
            onClick={() => setSelected(selected.size === allIds.size ? new Set() : new Set(allIds))}
            className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs hover:bg-secondary/60"
          >
            {selected.size === allIds.size && allIds.size > 0 ? <CheckSquare className="h-3.5 w-3.5" /> : <SquareIcon className="h-3.5 w-3.5" />}
            {selected.size === allIds.size && allIds.size > 0 ? "Clear all" : "Select all"}
          </button>
        </div>

        {/* Kanban Board */}
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="mt-6 flex gap-3 overflow-x-auto pb-4">
            {STAGES.map((stage) => {
              const list = effectiveApps.filter(a => a.pipeline_status === stage.id);
              return (
                <div key={stage.id} className="flex w-64 shrink-0 flex-col gap-2 lg:w-72">
                  {/* Column header */}
                  <div className={`flex items-center justify-between rounded-2xl border px-3 py-2 ${stage.color}`}>
                    <span className="text-xs font-bold uppercase tracking-wider">{stage.label}</span>
                    <span className="rounded-full bg-white/40 px-2 py-0.5 text-xs font-semibold">{list.length}</span>
                  </div>
                  {/* Droppable column */}
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`min-h-[200px] flex-1 space-y-2 rounded-2xl p-1.5 transition ${snapshot.isDraggingOver ? "bg-primary/5 ring-2 ring-primary/20" : "bg-transparent"}`}
                      >
                        {list.map((a, index) => {
                          const isSel = selected.has(a.id);
                          return (
                            <Draggable key={a.id} draggableId={a.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  style={provided.draggableProps.style as React.CSSProperties}
                                  className={`glass-strong cursor-grab rounded-2xl p-3 active:cursor-grabbing ${snapshot.isDragging ? "shadow-2xl rotate-1 opacity-90" : ""} ${isSel ? "ring-2 ring-foreground/40" : ""}`}
                                >
                                  <div className="flex items-start gap-2">
                                    <button
                                      onClick={e => { e.stopPropagation(); toggle(a.id); }}
                                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                                    >
                                      {isSel ? <CheckSquare className="h-3.5 w-3.5" /> : <SquareIcon className="h-3.5 w-3.5" />}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <Link
                                        to="/recruiter/applications/$applicationId"
                                        params={{ applicationId: a.id }}
                                        className="block truncate text-sm font-semibold hover:underline"
                                        onClick={e => e.stopPropagation()}
                                      >
                                        {a.profiles?.full_name || "Anonymous"}
                                      </Link>
                                      <div className="mt-1 flex items-center gap-2">
                                        <Star className="h-3 w-3 text-amber-500" />
                                        <ScoreBadge score={a.score} />
                                      </div>
                                    </div>
                                  </div>
                                  {a.ai_summary && (
                                    <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                                      {a.ai_summary}
                                    </p>
                                  )}
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                        {list.length === 0 && !snapshot.isDraggingOver && (
                          <p className="py-8 text-center text-xs text-muted-foreground/50">Drop here</p>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>

        {/* Bulk actions bar */}
        {selected.size > 0 && (
          <div
            role="region"
            aria-label="Bulk actions"
            className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-2xl backdrop-blur"
          >
            <div className="flex items-center gap-3">
              <button onClick={() => setSelected(new Set())} className="rounded-full p-1 hover:bg-secondary" aria-label="Clear selection">
                <X className="h-4 w-4" />
              </button>
              <p className="text-sm font-medium">{selected.size} selected</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setNotifyOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                <Mail className="h-3 w-3" /> Notify
              </button>
              <button onClick={openCompare} disabled={selected.size < 2} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-foreground hover:text-background disabled:opacity-50">
                <Columns className="h-3 w-3" /> Compare
              </button>
              {STAGES.map((s) => (
                <button
                  key={s.id}
                  disabled={bulk.isPending}
                  onClick={() => bulk.mutate(s.id)}
                  className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-foreground hover:text-background disabled:opacity-60"
                >
                  → {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notify modal */}
        {notifyOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setNotifyOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="glass-strong w-full max-w-xl rounded-3xl p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">Notify {selected.size} candidates</h2>
                <button onClick={() => setNotifyOpen(false)} className="rounded-full p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <select value={chosenTplId} onChange={(e) => applyTpl(e.target.value)} className="rounded-full border border-border bg-background/40 px-3 py-2 text-sm">
                    <option value="">Choose template (optional)</option>
                    {msgTpls?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <select value={channel} onChange={(e) => setChannel(e.target.value as "email" | "inapp" | "both")} className="rounded-full border border-border bg-background/40 px-3 py-2 text-sm">
                    <option value="both">Email + in-app</option>
                    <option value="email">Email only</option>
                    <option value="inapp">In-app only</option>
                  </select>
                </div>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full rounded-full border border-border bg-background/40 px-4 py-2 text-sm" />
                <textarea rows={6} value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} placeholder="Message body (markdown). Use {{candidate_name}}, {{job_title}}, {{company_name}}, {{recruiter_name}}." className="w-full rounded-2xl border border-border bg-background/40 p-3 text-sm" />
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setNotifyOpen(false)} className="rounded-full bg-secondary px-4 py-2 text-sm">Cancel</button>
                <button disabled={notify.isPending || !subject.trim() || !bodyMd.trim()} onClick={() => notify.mutate()} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  <Mail className="h-4 w-4" /> {notify.isPending ? "Sending…" : `Send to ${selected.size}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
