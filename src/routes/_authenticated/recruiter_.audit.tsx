import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/firebase/client";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { SiteNav } from "@/components/site-nav";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/recruiter_/audit")({
  head: () => ({ meta: [{ title: "Role audit · Crux" }] }),
  component: RoleAuditPage,
});

type AuditRow = {
  id: string;
  user_id: string;
  email: string | null;
  role: string;
  source: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

function RoleAuditPage() {
  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["role-audit"],
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, "role_audit"),
        orderBy("created_at", "desc"),
        limit(200),
      ));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AuditRow[];
    },
  });

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link to="/recruiter" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to recruiter
        </Link>

        <div className="mt-4 mb-8 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Role audit trail</h1>
            <p className="text-sm text-muted-foreground">Every role assignment, with source, IP, and user agent.</p>
          </div>
        </div>

        <div className="glass-strong overflow-hidden rounded-3xl">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="p-10 text-center text-sm text-destructive">{(error as Error).message}</div>
          ) : !rows || rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No audit events yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">When</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">IP</th>
                    <th className="px-4 py-3 text-left">Agent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-secondary/30">
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background capitalize">{r.role}</span>
                      </td>
                      <td className="px-4 py-3">{r.email ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.user_id.slice(0, 8)}…</td>
                      <td className="px-4 py-3 capitalize">{r.source}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.ip ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 max-w-[260px] truncate text-xs text-muted-foreground" title={r.user_agent ?? ""}>{r.user_agent ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
