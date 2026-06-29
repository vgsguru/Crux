import { BadgeCheck } from "lucide-react";

export function VerifiedBadge({ status, size = "sm", showLabel = true }: {
  status: string | null | undefined;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  if (status !== "verified") return null;
  const px = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <span
      title="Verified company"
      aria-label="Verified company"
      className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-foreground"
    >
      <BadgeCheck className={px} />
      {showLabel && <span>Verified</span>}
    </span>
  );
}
