import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { auth, db } from "@/integrations/firebase/client";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Briefcase, User, GraduationCap, Rocket, Building2, Check, X, Loader2 } from "lucide-react";
import { ensureUsername, claimUsername, resolveUsername, RESERVED_USERNAMES } from "@/lib/username";
import { lookupLoginEmail } from "@/lib/auth.server";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in · Crux" }, { name: "description", content: "Sign in or create an account for Crux." }] }),
  component: AuthPage,
});

type Mode = "signin" | "signup";
type Role = "recruiter" | "applicant";
type Category = "student" | "graduate" | "experienced";

const CATEGORIES: { value: Category; label: string; icon: typeof User; hint: string }[] = [
  { value: "student", label: "Student", icon: GraduationCap, hint: "Currently studying" },
  { value: "graduate", label: "Recent graduate", icon: GraduationCap, hint: "Finished, job hunting" },
  { value: "experienced", label: "Experienced", icon: Rocket, hint: "Already working" },
];

function AuthPage() {
  const navigate = useNavigate();
  const lookupEmailFn = useServerFn(lookupLoginEmail);
  const [mode, setMode] = useState<Mode>("signin");
  const [role, setRole] = useState<Role>("applicant");
  const [category, setCategory] = useState<Category>("student");
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState(""); // email OR username (sign in)
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  // Desired public handle (sign up) + live availability check.
  const [username, setUsername] = useState("");
  const [unameStatus, setUnameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  useEffect(() => {
    const u = username.trim().toLowerCase();
    if (!u) { setUnameStatus("idle"); return; }
    if (u.length < 3 || RESERVED_USERNAMES.has(u)) { setUnameStatus("invalid"); return; }
    setUnameStatus("checking");
    const t = setTimeout(async () => {
      try { setUnameStatus((await resolveUsername(u)) ? "taken" : "available"); }
      catch { setUnameStatus("idle"); }
    }, 450);
    return () => clearTimeout(t);
  }, [username]);

  // Category-specific fields
  const [college, setCollege] = useState("");
  const [degree, setDegree] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [yearsExp, setYearsExp] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) navigate({ to: "/" });
    });
    return () => unsub();
  }, [navigate]);

  function buildDetails() {
    if (role !== "applicant") return { role: "recruiter" as const, headline: "Recruiter" };
    if (category === "experienced") {
      return {
        category,
        current_company: company.trim() || null,
        current_title: jobTitle.trim() || null,
        years_of_experience: yearsExp ? Number(yearsExp) : null,
        headline: [jobTitle.trim(), company.trim() && `at ${company.trim()}`].filter(Boolean).join(" "),
      };
    }
    return {
      category,
      college: college.trim() || null,
      degree: degree.trim() || null,
      field_of_study: fieldOfStudy.trim() || null,
      graduation_year: gradYear ? Number(gradYear) : null,
      headline: category === "student"
        ? [degree.trim() && `${degree.trim()} student`, college.trim()].filter(Boolean).join(" · ")
        : [degree.trim(), fieldOfStudy.trim()].filter(Boolean).join(", "),
    };
  }

  function validateSignup(): boolean {
    if (!fullName.trim()) { toast.error("Please enter your full name"); return false; }
    if (role === "applicant") {
      if (category === "experienced") {
        if (!company.trim() || !jobTitle.trim()) { toast.error("Company and job title are required"); return false; }
      } else {
        if (!college.trim() || !degree.trim()) { toast.error("College/university and degree are required"); return false; }
      }
    }
    return true;
  }

  async function ensureRole(userId: string, r: Role, name: string, avatarUrl: string | null, details: Record<string, unknown>) {
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, { role: r, full_name: name, created_at: new Date().toISOString() });
    }
    // Merge profile (works even if it exists) — stores category + mandatory details.
    await setDoc(doc(db, "profiles", userId), {
      full_name: name,
      avatar_url: avatarUrl,
      created_at: new Date().toISOString(),
      ...details,
    }, { merge: true });
    // Claim the chosen handle if available, else auto-generate a unique one.
    const desired = username.trim().toLowerCase();
    if (desired && unameStatus === "available") {
      const res = await claimUsername(userId, desired);
      if (!res.ok) { try { await ensureUsername(userId, name); } catch {} }
    } else {
      try { await ensureUsername(userId, name); } catch { /* non-blocking */ }
    }
  }

  async function signInWithGoogle() {
    if (mode === "signup" && !validateSignup()) return;
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      const name = fullName.trim() || cred.user.displayName || "";
      await ensureRole(cred.user.uid, role, name, cred.user.photoURL ?? null, mode === "signup" ? buildDetails() : {});
      toast.success("Welcome to Crux.");
      navigate({ to: role === "recruiter" ? "/recruiter" : "/" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !validateSignup()) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await ensureRole(cred.user.uid, role, fullName, null, buildDetails());
        toast.success("Account created. Welcome to Crux.");
        navigate({ to: role === "recruiter" ? "/recruiter" : "/" });
      } else {
        let loginEmail = loginId.trim();
        if (!loginEmail.includes("@")) {
          // It's a username — resolve to the account email.
          const res = await lookupEmailFn({ data: { handle: loginEmail } }) as { email: string | null };
          if (!res.email) throw new Error("No account found with that username");
          loginEmail = res.email;
        }
        await signInWithEmailAndPassword(auth, loginEmail, password);
        toast.success("Welcome back.");
        navigate({ to: "/" });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-foreground/30";



  return (
    <div className="bg-ambient min-h-screen px-4 py-8">
      <button onClick={() => window.history.length > 1 ? window.history.back() : navigate({ to: "/" })} className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="mx-auto flex max-w-md flex-col items-center pt-2">
        <Link to="/" className="mb-6 flex items-center justify-center gap-3">
          <img src="/logo_black.png" alt="Crux" className="h-14 dark:hidden" />
          <img src="/logo_white.png" alt="Crux" className="h-14 hidden dark:block" />
          <span className="font-display text-5xl font-bold tracking-tight text-foreground">Crux</span>
        </Link>

        <div className="glass-strong w-full rounded-3xl p-7">
          <div className="mb-5 flex rounded-full bg-secondary p-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition ${mode === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {mode === "signup" && (
            <>
              <div className="mb-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">I am a…</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: "applicant" as const, label: "Job seeker", icon: User },
                    { value: "recruiter" as const, label: "Recruiter", icon: Briefcase },
                  ]).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRole(value)}
                      className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-medium transition ${role === value ? "bg-primary text-primary-foreground shadow-sm" : "glass text-foreground hover:bg-secondary/60"}`}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {role === "applicant" && (
                <div className="mb-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Where are you in your career?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {CATEGORIES.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setCategory(value)}
                        className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-medium transition ${category === value ? "bg-primary text-primary-foreground shadow-sm" : "glass text-foreground hover:bg-secondary/60"}`}
                      >
                        <Icon className="h-4 w-4" /> {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" required className={inputCls} />
            )}
            {mode === "signup" && (
              <div>
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-4 py-3 focus-within:border-foreground/30">
                  <span className="shrink-0 text-sm text-muted-foreground">crux.app/</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="username" className="w-full bg-transparent text-sm outline-none" />
                  {unameStatus === "checking" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                  {unameStatus === "available" && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                  {(unameStatus === "taken" || unameStatus === "invalid") && <X className="h-4 w-4 shrink-0 text-destructive" />}
                </div>
                <p className={`mt-1 text-xs ${unameStatus === "taken" || unameStatus === "invalid" ? "text-destructive" : "text-muted-foreground"}`}>
                  {unameStatus === "taken" ? "That handle is taken — try another." : unameStatus === "invalid" ? "3+ chars; letters, numbers, underscore." : unameStatus === "available" ? "Available! This is your public profile link & login." : "Pick a unique handle (also used to log in). Leave blank to auto-generate."}
                </p>
              </div>
            )}

            {/* Category-specific mandatory details */}
            {mode === "signup" && role === "applicant" && category !== "experienced" && (
              <div className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><GraduationCap className="h-3.5 w-3.5" /> {category === "student" ? "Your studies" : "Your education"}</p>
                <input value={college} onChange={(e) => setCollege(e.target.value)} placeholder="College / University *" required className={inputCls} />
                <div className="grid grid-cols-2 gap-2">
                  <input value={degree} onChange={(e) => setDegree(e.target.value)} placeholder="Degree (e.g. B.Tech) *" required className={inputCls} />
                  <input value={fieldOfStudy} onChange={(e) => setFieldOfStudy(e.target.value)} placeholder="Field of study" className={inputCls} />
                </div>
                <input type="number" value={gradYear} onChange={(e) => setGradYear(e.target.value)} placeholder={category === "student" ? "Expected graduation year" : "Graduation year"} className={inputCls} />
              </div>
            )}
            {mode === "signup" && role === "applicant" && category === "experienced" && (
              <div className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Rocket className="h-3.5 w-3.5" /> Your experience</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Current title *" required className={inputCls} />
                  <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company *" required className={inputCls} />
                </div>
                <input type="number" step="0.5" value={yearsExp} onChange={(e) => setYearsExp(e.target.value)} placeholder="Years of experience" className={inputCls} />
              </div>
            )}
            {mode === "signup" && role === "recruiter" && (
              <p className="flex items-center gap-1.5 rounded-2xl bg-secondary/50 px-3 py-2 text-xs text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> You'll set up your company after signing up.</p>
            )}

            {mode === "signup" ? (
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" required className={inputCls} />
            ) : (
              <input type="text" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Email or username" required className={inputCls} />
            )}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required minLength={6} className={inputCls} />
            <button type="submit" disabled={busy} className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm font-medium text-foreground transition hover:bg-secondary/60 disabled:opacity-60"
          >
            <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
              <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
            </svg>
            Continue with Google
          </button>

        </div>
      </div>
    </div>
  );
}
