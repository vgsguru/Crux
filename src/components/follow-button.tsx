import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/hooks/use-auth";
import { followCompany, unfollowCompany, followId } from "@/lib/follow";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function FollowButton({ companyId, className }: { companyId: string; className?: string }) {
  const { user, isRecruiter } = useAuth();
  const qc = useQueryClient();
  const { data: following } = useQuery({
    queryKey: ["following", user?.id, companyId],
    enabled: !!user,
    queryFn: async () => (await getDoc(doc(db, "follows", followId(user!.id, companyId)))).exists(),
  });

  // Recruiters don't follow companies in the candidate sense; hide for them and signed-out.
  if (!user || isRecruiter) return null;

  async function toggle() {
    try {
      if (following) await unfollowCompany(user!.id, companyId);
      else { await followCompany(user!.id, companyId); toast.success("Following — their posts will show first"); }
      qc.invalidateQueries({ queryKey: ["following", user!.id, companyId] });
      qc.invalidateQueries({ queryKey: ["my-follows", user!.id] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <button
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
        following ? "bg-secondary text-foreground hover:bg-secondary/70" : "bg-primary text-primary-foreground hover:opacity-90",
        className,
      )}
    >
      {following ? <><Check className="h-4 w-4" /> Following</> : <><Plus className="h-4 w-4" /> Follow</>}
    </button>
  );
}
