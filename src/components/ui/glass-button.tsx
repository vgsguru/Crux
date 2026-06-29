import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type GlassButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** "primary" tints the surface with the brand color; "default" is neutral glass. */
  variant?: "default" | "primary";
};

/**
 * Liquid-glass button — frosted surface with specular highlights, matching the
 * floating navbar. Use for prominent CTAs over imagery / ambient backgrounds.
 */
export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "glass-panel inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-transform hover:scale-[1.04] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          variant === "primary"
            ? "bg-primary/80 text-primary-foreground"
            : "text-foreground/90 hover:text-foreground",
          className,
        )}
        {...props}
      >
        <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      </button>
    );
  },
);
GlassButton.displayName = "GlassButton";
