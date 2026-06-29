import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { auth, db } from "@/integrations/firebase/client";
import { signOut as firebaseSignOut } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { motion, AnimatePresence } from "motion/react";
import {
  LogOut, Home, Rss, FileText, Briefcase, User, Bell, Menu,
  Bookmark, LayoutDashboard, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  search?: Record<string, unknown>;
  icon: typeof Home;
  label: string;
  active: (path: string) => boolean;
};

/**
 * True when the floating nav currently sits over a dark section. Sections opt in
 * with `data-nav-surface="dark"`; we watch only the top strip of the viewport
 * (where the nav floats) so the icons/logo invert as you scroll over dark areas.
 */
function useNavOnDark(): boolean {
  const [onDark, setOnDark] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-nav-surface='dark']"));
    if (!els.length) { setOnDark(false); return; }
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setOnDark(visible.size > 0);
      },
      // Only the top ~8% band (where the nav sits) counts as "behind the nav".
      { rootMargin: "0px 0px -92% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);
  return onDark;
}

export function SiteNav() {
  const { user, isRecruiter, isAdmin } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const onDark = useNavOnDark();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  // Close the menu whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  async function signOut() {
    await firebaseSignOut(auth);
    navigate({ to: "/" });
  }

  // Live unread-notifications badge.
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    const q = query(
      collection(db, "notifications"),
      where("user_id", "==", user.uid),
      where("read_at", "==", null),
    );
    const unsub = onSnapshot(q, (snap) => setUnreadCount(snap.size), () => setUnreadCount(0));
    return () => unsub();
  }, [user]);

  // Background-reactive colors.
  const strong = onDark ? "text-white" : "text-foreground";
  const idle = onDark ? "text-white/70 hover:text-white" : "text-foreground/65 hover:text-foreground";
  const semi = onDark ? "text-white/85 hover:text-white" : "text-foreground/80 hover:text-foreground";
  const iconBtn = cn(
    "grid h-10 w-10 place-items-center rounded-full transition-transform hover:scale-[1.06] active:scale-95",
    onDark ? "hover:bg-white/15" : "hover:bg-foreground/10",
  );

  const items: NavItem[] = [
    { to: "/", icon: Home, label: "Home", active: (p) => p === "/" },
    { to: "/jobs", icon: Briefcase, label: "Jobs", active: (p) => p.startsWith("/jobs") },
  ];
  if (user) {
    items.push({ to: "/feed", search: { tab: "jobs" }, icon: Rss, label: "Feed", active: (p) => p.startsWith("/feed") });
    if (isRecruiter) {
      items.push({ to: "/recruiter", icon: LayoutDashboard, label: "Recruiter", active: (p) => p.startsWith("/recruiter") });
    } else {
      items.push({ to: "/me/applications", icon: FileText, label: "My applications", active: (p) => p.startsWith("/me/applications") });
    }
  }

  return (
    <header className="sticky top-0 z-50 flex justify-center px-4 pt-4 pb-2">
      <div ref={menuRef} className="relative">
        <nav
          aria-label="Primary"
          className="glass-panel flex w-fit items-center justify-between gap-2 rounded-full px-3 py-2"
        >
          {/* Logo + wordmark */}
          <Link to="/" aria-label="Crux home" className="mr-1 flex items-center gap-2 pl-0.5">
            <img src={onDark ? "/logo_white.png" : "/logo_black.png"} alt="Crux" className="h-9 w-auto" />
            <span className={cn("font-display text-2xl font-bold tracking-tight", strong)}>Crux</span>
          </Link>

          {/* Primary nav */}
          <div className="flex items-center gap-1">
            {items.map(({ to, search, icon: Icon, label, active }) => {
              const isActive = active(pathname);
              return (
                <Link
                  key={to}
                  to={to}
                  search={search as any}
                  aria-label={label}
                  title={label}
                  className={cn(
                    "relative grid h-10 w-10 place-items-center rounded-full transition-colors",
                    isActive ? strong : idle,
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="active-glass-chip"
                      className="glass-chip absolute inset-0 rounded-full"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon className="relative z-10 h-[21px] w-[21px]" strokeWidth={2} />
                </Link>
              );
            })}
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-1">
            {user ? (
              <>
                <Link
                  to="/me/notifications"
                  aria-label="Notifications"
                  title="Notifications"
                  className={cn(iconBtn, "relative", semi)}
                >
                  <Bell className="h-[19px] w-[19px]" strokeWidth={2} />
                  {unreadCount ? (
                    <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background/60" />
                  ) : null}
                </Link>
                <button
                  type="button"
                  aria-label="Menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                  className={cn(iconBtn, menuOpen ? strong : semi)}
                >
                  <Menu className="h-[19px] w-[19px]" strokeWidth={2} />
                </button>
              </>
            ) : (
              <Link
                to="/auth"
                className="glass-panel ml-1 rounded-full bg-primary/80 px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.04] active:scale-[0.97]"
              >
                Sign in
              </Link>
            )}
          </div>
        </nav>

        {/* Dropdown menu */}
        <AnimatePresence>
          {menuOpen && user && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="glass-panel absolute right-0 top-full mt-2 flex min-w-[12rem] flex-col gap-1 rounded-2xl p-2"
            >
              <MenuLink to="/profile/$userId" params={{ userId: user.uid }} icon={User} label="My profile" onDark={onDark} />
              <MenuLink to="/me/saved" icon={Bookmark} label="Saved jobs" onDark={onDark} />
              {isRecruiter && <MenuLink to="/recruiter/company" icon={LayoutDashboard} label="Company settings" onDark={onDark} />}
              {isAdmin && <MenuLink to="/admin" icon={ShieldCheck} label="Admin console" onDark={onDark} />}
              <div className={cn("my-1 h-px", onDark ? "bg-white/15" : "bg-foreground/10")} />
              <button
                type="button"
                onClick={signOut}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-destructive/10 hover:text-destructive",
                  onDark ? "text-white/90" : "text-foreground/90",
                )}
              >
                <LogOut className="h-4 w-4" strokeWidth={2} />
                <span>Log out</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

function MenuLink({ to, params, icon: Icon, label, onDark }: { to: string; params?: Record<string, string>; icon: typeof User; label: string; onDark?: boolean }) {
  return (
    <Link
      to={to}
      params={params as any}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
        onDark ? "text-white/90 hover:bg-white/10" : "text-foreground/90 hover:bg-foreground/10",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
      <span>{label}</span>
    </Link>
  );
}
