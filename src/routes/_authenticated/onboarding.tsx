import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { parseProfileResume, completeRecruiterOnboarding } from "@/lib/resume.server";
import { extractPdfText } from "@/lib/pdf-text";
import { toast } from "sonner";
import { Briefcase, UploadCloud, User, Loader2, ArrowRight } from "lucide-react";
import { assignRecruiterRoleOnSignup } from "@/lib/ai.server";
import { storage } from "@/integrations/firebase/client";
import { uploadToBlob } from "@/lib/upload";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user, isRecruiter, isApplicant } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<"applicant" | "recruiter" | null>(null);
  const [busy, setBusy] = useState(false);

  // Recruiter fields
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");

  // Applicant manual form fields
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualHeadline, setManualHeadline] = useState("");
  const [manualBio, setManualBio] = useState("");

  const parseResumeFn = useServerFn(parseProfileResume);
  const finishRecruiterFn = useServerFn(completeRecruiterOnboarding);
  const assignRoleFn = useServerFn(assignRecruiterRoleOnSignup);

  // We need to implement a server function to save manual profile, but we can do it via Firestore client directly here since we have the hook
  const fileInputRef = useRef<HTMLInputElement>(null);

  // If already onboarded, we shouldn't be here, but we rely on a hook or backend to route.
  // For now, if role is set in the session, we check it.

  async function handleSelectRole(r: "applicant" | "recruiter") {
    if ((user as any)?.role) {
      setRole((user as any).role as "applicant" | "recruiter");
      return;
    }
    setBusy(true);
    try {
      if (r === "recruiter") {
        await assignRoleFn();
        setRole("recruiter");
        toast.success("Welcome, recruiter!");
      } else {
        // applicant doesn't need to assign role, default is applicant
        setRole("applicant");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const effectiveRole = (user as any)?.role || role;

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setBusy(true);
    toast("Uploading and parsing resume...");
    try {
      // 1. Upload to Vercel Blob
      await uploadToBlob(file, `resumes/${user.id}`);

      // 2. Extract text in the browser, then parse with AI.
      const resumeText = await extractPdfText(file);
      if (!resumeText || resumeText.length < 30) throw new Error("Couldn't read text from this PDF — is it a scanned image?");
      await parseResumeFn({ data: { resumeText } });
      toast.success("Profile generated successfully!");
      navigate({ to: "/me/profile" });
    } catch (err: any) {
      toast.error("Upload failed: " + err.message);
      setBusy(false);
    }
  }

  async function submitRecruiter(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) return;
    setBusy(true);
    try {
      await finishRecruiterFn({ data: { companyName, websiteUrl: companyWebsite } });
      toast.success("Company profile created!");
      navigate({ to: "/recruiter/company" });
    } catch (err: any) {
      toast.error(err.message);
      setBusy(false);
    }
  }

  async function submitManualProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const { doc, setDoc, getFirestore } = await import("firebase/firestore");
      const db = getFirestore();
      await setDoc(doc(db, "profiles", user.uid), {
        full_name: manualName,
        headline: manualHeadline,
        bio: manualBio,
        updated_at: new Date().toISOString()
      }, { merge: true });
      toast.success("Profile created!");
      navigate({ to: "/me/profile" });
    } catch (err: any) {
      toast.error(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="bg-ambient flex min-h-screen items-center justify-center p-4">
      <div className="glass-strong w-full max-w-xl rounded-3xl p-8 sm:p-12">
        {!effectiveRole ? (
          <>
            <div className="text-center">
              <h1 className="font-display text-3xl font-bold tracking-tight">Welcome to Crux</h1>
              <p className="mt-2 text-sm text-muted-foreground">How will you be using Crux today?</p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <button
                onClick={() => handleSelectRole("applicant")}
                disabled={busy}
                className="group relative flex flex-col items-center gap-4 rounded-2xl border border-border bg-background/50 p-6 text-center transition hover:border-foreground/30 hover:bg-secondary disabled:opacity-50"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary transition group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                  <User className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold">I'm a Candidate</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Looking for jobs and taking interviews.</p>
                </div>
              </button>
              <button
                onClick={() => handleSelectRole("recruiter")}
                disabled={busy}
                className="group relative flex flex-col items-center gap-4 rounded-2xl border border-border bg-background/50 p-6 text-center transition hover:border-foreground/30 hover:bg-secondary disabled:opacity-50"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary transition group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Briefcase className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold">I'm a Recruiter</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Posting jobs and reviewing candidates.</p>
                </div>
              </button>
            </div>
          </>
        ) : effectiveRole === "applicant" || isApplicant ? (
          showManualForm ? (
            <div>
              <div className="text-center">
                <h1 className="font-display text-3xl font-bold tracking-tight">Basic Profile Details</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Let's get the essentials down to start your job hunt.
                </p>
              </div>
              <form onSubmit={submitManualProfile} className="mt-8 space-y-4 text-left">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Full Name</label>
                  <input
                    type="text"
                    required
                    value={manualName}
                    onChange={e => setManualName(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background/50 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Headline</label>
                  <input
                    type="text"
                    required
                    value={manualHeadline}
                    onChange={e => setManualHeadline(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background/50 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                    placeholder="Software Engineer | Problem Solver"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Short Bio</label>
                  <textarea
                    required
                    rows={3}
                    value={manualBio}
                    onChange={e => setManualBio(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background/50 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                    placeholder="Tell us a little about your professional background..."
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Complete profile"} <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualForm(false)}
                  disabled={busy}
                  className="mt-4 w-full text-center text-sm text-muted-foreground underline hover:text-foreground"
                >
                  Back to resume upload
                </button>
              </form>
            </div>
          ) : (
            <div className="text-center">
              <h1 className="font-display text-3xl font-bold tracking-tight">Set up your profile</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload your resume and we'll automatically generate your profile to save you time.
              </p>
              
              <div className="mt-8">
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={onFileSelected}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="group relative flex w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-border bg-background/40 py-16 transition hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
                >
                  {busy ? (
                    <div className="flex flex-col items-center gap-2 text-primary">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="text-sm font-medium">Extracting profile...</span>
                    </div>
                  ) : (
                    <>
                      <div className="grid h-16 w-16 place-items-center rounded-full bg-secondary text-muted-foreground transition group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                        <UploadCloud className="h-8 w-8" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Click to upload your resume</p>
                        <p className="mt-1 text-xs text-muted-foreground">PDF only, max 5MB</p>
                      </div>
                    </>
                  )}
                </button>
              </div>
              
              <button
                onClick={() => setShowManualForm(true)}
                disabled={busy}
                className="mt-6 text-sm text-muted-foreground underline hover:text-foreground"
              >
                Skip and fill out manually
              </button>
            </div>
          )
        ) : (
          <div>
            <div className="text-center">
              <h1 className="font-display text-3xl font-bold tracking-tight">Company details</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Set up your company profile to start posting roles.
              </p>
            </div>
            <form onSubmit={submitRecruiter} className="mt-8 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company Name</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background/50 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Website (Optional)</label>
                <input
                  type="url"
                  value={companyWebsite}
                  onChange={e => setCompanyWebsite(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background/50 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                  placeholder="https://acmecorp.com"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Complete setup"} <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
