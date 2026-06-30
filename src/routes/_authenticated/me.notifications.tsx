import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { db } from "@/integrations/firebase/client";
import { collection, query, where, orderBy, limit, getDocs, doc, updateDoc, getDoc } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { markNotificationRead } from "@/lib/messaging.server";
import { ArrowLeft, CheckCheck, Bell, UserPlus, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/me/notifications")({
  component: NotificationsPage,
});

type N = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const markFn = useServerFn(markNotificationRead);
  
  const { data } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Equality-only (no composite index); sort + cap in JS.
      const q = query(collection(db, "notifications"), where("user_id", "==", user!.id));
      const snap = await getDocs(q);
      return (snap.docs.map(d => ({ id: d.id, ...d.data() })) as N[])
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 100);
    },
  });
  const markAll = useMutation({
    mutationFn: async () => markFn({ data: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const mark = useMutation({
    mutationFn: async (id: string) => markFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Pending "I recruited you" confirmations (verified recruitment count).
  const { data: pendingClaims } = useQuery({
    queryKey: ["recruit-claims-pending", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "recruitment_claims"),
        where("member_id", "==", user!.id),
        where("status", "==", "pending"),
      ));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);
      // Resolve the recruiter's company name for context.
      return Promise.all(rows.map(async (r) => {
        const compSnap = await getDocs(query(collection(db, "companies"), where("owner_id", "==", r.recruiter_id)));
        return { ...r, company_name: compSnap.empty ? null : (compSnap.docs[0].data() as any).name };
      }));
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      await updateDoc(doc(db, "recruitment_claims", id), { status: approve ? "approved" : "rejected", decided_at: new Date().toISOString() });
    },
    onSuccess: (_d, v) => { toast.success(v.approve ? "Confirmed — it now counts on their profile" : "Declined"); qc.invalidateQueries({ queryKey: ["recruit-claims-pending"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Home</Link>
        <div className="mt-3 flex items-end justify-between">
          <h1 className="font-display text-3xl font-bold tracking-tight">Notifications</h1>
          <button onClick={() => markAll.mutate()} className="glass inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs hover:bg-secondary/60"><CheckCheck className="h-3.5 w-3.5" /> Mark all read</button>
        </div>

        {pendingClaims && pendingClaims.length > 0 && (
          <div className="mt-6 space-y-2">
            <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground"><UserPlus className="h-4 w-4" /> Recruitment confirmations</h2>
            {pendingClaims.map((c) => (
              <div key={c.id} className="glass-strong rounded-2xl p-4">
                <p className="text-sm"><span className="font-semibold">{c.company_name ?? "A recruiter"}</span> says they recruited you on Crux.</p>
                <p className="mt-1 text-xs text-muted-foreground">Confirm only if it's true — it adds to their verified recruitment count.</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => decide.mutate({ id: c.id, approve: true })} disabled={decide.isPending} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Confirm</button>
                  <button onClick={() => decide.mutate({ id: c.id, approve: false })} disabled={decide.isPending} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"><X className="h-3.5 w-3.5" /> Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-2">
          {(!data || data.length === 0) && <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-3 h-5 w-5" />No notifications.</div>}
          {data?.map((n) => (
            <div key={n.id} className={`glass rounded-2xl p-4 ${n.read_at ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-semibold">{n.title}</p>
                  {n.body && <p className="mt-1 text-xs text-foreground/80">{n.body}</p>}
                  <p className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                <div className="flex gap-1">
                  {n.link && <a href={n.link} className="rounded-full bg-secondary px-3 py-1 text-xs">Open</a>}
                  {!n.read_at && <button onClick={() => mark.mutate(n.id)} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"><CheckCheck className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
