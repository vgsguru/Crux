import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { adminStats, adminListUsers, adminSetRole, adminListReports, adminResolveReport, adminListVerifications } from "@/lib/admin.server";
import { decideCompanyVerification } from "@/lib/match.server";
import { ShieldCheck, Users, Building2, Briefcase, FileText, Flag, Check, X, BadgeCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin · Crux" }] }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const statsFn = useServerFn(adminStats);
  const usersFn = useServerFn(adminListUsers);
  const setRoleFn = useServerFn(adminSetRole);
  const reportsFn = useServerFn(adminListReports);
  const resolveFn = useServerFn(adminResolveReport);
  const verFn = useServerFn(adminListVerifications);
  const decideFn = useServerFn(decideCompanyVerification);

  const { data: stats } = useQuery({ queryKey: ["admin-stats"], enabled: isAdmin, queryFn: () => statsFn({}) as Promise<any> });
  const { data: users } = useQuery({ queryKey: ["admin-users"], enabled: isAdmin, queryFn: () => usersFn({}) as Promise<any[]> });
  const { data: reports } = useQuery({ queryKey: ["admin-reports"], enabled: isAdmin, queryFn: () => reportsFn({}) as Promise<any[]> });
  const { data: vers } = useQuery({ queryKey: ["admin-vers"], enabled: isAdmin, queryFn: () => verFn({}) as Promise<any[]> });

  const setRole = useMutation({
    mutationFn: (v: { uid: string; role: "admin" | "recruiter" | "applicant" }) => setRoleFn({ data: v }),
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const decide = useMutation({
    mutationFn: (v: { verificationId: string; approve: boolean }) => decideFn({ data: v }),
    onSuccess: () => { toast.success("Done"); qc.invalidateQueries({ queryKey: ["admin-vers"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const resolve = useMutation({
    mutationFn: (v: { id: string; action: "resolved" | "dismissed" }) => resolveFn({ data: v }),
    onSuccess: () => { toast.success("Report updated"); qc.invalidateQueries({ queryKey: ["admin-reports"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (!loading && !isAdmin) {
    return (
      <div className="bg-ambient min-h-screen">
        <SiteNav />
        <main className="mx-auto max-w-4xl px-4 py-20 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 font-display text-2xl font-bold">Admins only</h1>
          <p className="mt-1 text-sm text-muted-foreground">You don't have access to the admin console.</p>
        </main>
      </div>
    );
  }

  const pendingVers = (vers ?? []).filter((v) => v.status === "pending");
  const openReports = (reports ?? []).filter((r) => r.status === "open");

  const STAT = [
    { icon: <Users className="h-5 w-5" />, label: "Users", value: stats?.users },
    { icon: <Building2 className="h-5 w-5" />, label: "Companies", value: stats?.companies },
    { icon: <BadgeCheck className="h-5 w-5" />, label: "Verified", value: stats?.verifiedCompanies },
    { icon: <Briefcase className="h-5 w-5" />, label: "Jobs", value: stats?.jobs },
    { icon: <FileText className="h-5 w-5" />, label: "Applications", value: stats?.applications },
    { icon: <Flag className="h-5 w-5" />, label: "Open reports", value: stats?.openReports },
  ];

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" />
          <h1 className="font-display text-3xl font-bold tracking-tight">Admin console</h1>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STAT.map((s) => (
            <div key={s.label} className="glass rounded-2xl p-4">
              <div className="text-muted-foreground">{s.icon}</div>
              <p className="mt-2 font-display text-2xl font-bold">{s.value ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Pending verifications */}
        <h2 className="mt-10 mb-3 font-display text-xl font-semibold">Company verifications {pendingVers.length > 0 && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">{pendingVers.length} pending</span>}</h2>
        <div className="space-y-2">
          {pendingVers.length === 0 && <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">No pending verifications.</div>}
          {pendingVers.map((v) => (
            <div key={v.id} className="glass-strong flex items-center justify-between gap-4 rounded-2xl p-4">
              <div className="min-w-0">
                <p className="font-medium">{v.company?.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{v.domain || v.company?.website || "no domain"} {v.evidence_url && <a href={v.evidence_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline">evidence <ExternalLink className="h-3 w-3" /></a>}</p>
                {v.notes && <p className="mt-1 text-xs text-foreground/70">“{v.notes}”</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => decide.mutate({ verificationId: v.id, approve: true })} disabled={decide.isPending} className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Verify</button>
                <button onClick={() => decide.mutate({ verificationId: v.id, approve: false })} disabled={decide.isPending} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"><X className="h-3.5 w-3.5" /> Reject</button>
              </div>
            </div>
          ))}
        </div>

        {/* Reports */}
        <h2 className="mt-10 mb-3 font-display text-xl font-semibold">Reports {openReports.length > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{openReports.length} open</span>}</h2>
        <div className="space-y-2">
          {openReports.length === 0 && <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">No open reports.</div>}
          {openReports.map((r) => (
            <div key={r.id} className="glass flex items-center justify-between gap-4 rounded-2xl p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize">{(r.content_type || "report").replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground">{r.reason || "(no reason)"}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => resolve.mutate({ id: r.id, action: "resolved" })} className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/70">Resolve</button>
                <button onClick={() => resolve.mutate({ id: r.id, action: "dismissed" })} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
              </div>
            </div>
          ))}
        </div>

        {/* Users */}
        <h2 className="mt-10 mb-3 font-display text-xl font-semibold">Users <span className="text-sm font-normal text-muted-foreground">({users?.length ?? 0})</span></h2>
        <div className="glass-strong overflow-hidden rounded-2xl">
          <div className="max-h-[28rem] overflow-y-auto divide-y divide-border">
            {(users ?? []).map((u) => (
              <div key={u.uid} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/30">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.full_name || "—"} {u.username && <span className="text-xs text-muted-foreground">@{u.username}</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email || u.uid.slice(0, 10) + "…"}</p>
                </div>
                <select
                  value={u.role ?? "applicant"}
                  onChange={(e) => setRole.mutate({ uid: u.uid, role: e.target.value as any })}
                  className="shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-xs"
                >
                  <option value="applicant">applicant</option>
                  <option value="recruiter">recruiter</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            ))}
            {(!users || users.length === 0) && <div className="p-6 text-center text-sm text-muted-foreground">Loading users…</div>}
          </div>
        </div>
      </main>
    </div>
  );
}
