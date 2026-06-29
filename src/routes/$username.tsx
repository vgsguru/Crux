import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { resolveUsername, RESERVED_USERNAMES } from "@/lib/username";
import { ProfileResolver } from "./_authenticated/profile.$userId";
import { SiteNav } from "@/components/site-nav";

// Public, shareable profile URL: crux.app/<username>. Static routes (/jobs, /feed,
// /auth, …) win over this dynamic segment, so only real handles resolve here.
export const Route = createFileRoute("/$username")({
  component: UsernamePage,
});

function UsernamePage() {
  const { username } = Route.useParams();
  const reserved = RESERVED_USERNAMES.has(username.toLowerCase());

  const { data: uid, isLoading } = useQuery({
    queryKey: ["username", username],
    enabled: !reserved,
    queryFn: () => resolveUsername(username),
  });

  if (!reserved && isLoading) {
    return (
      <div className="bg-ambient min-h-screen">
        <SiteNav />
        <div className="mx-auto max-w-5xl px-4 py-20 text-center">
          <div className="glass rounded-3xl p-10 animate-pulse text-muted-foreground">Loading profile…</div>
        </div>
      </div>
    );
  }

  if (reserved || !uid) {
    return (
      <div className="bg-ambient flex min-h-screen items-center justify-center px-4">
        <div className="glass max-w-md rounded-3xl px-10 py-12 text-center">
          <h1 className="font-display text-2xl font-bold">Profile not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">No Crux profile exists at “{username}”.</p>
          <Link to="/" className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">Go home</Link>
        </div>
      </div>
    );
  }

  return <ProfileResolver userId={uid} />;
}
