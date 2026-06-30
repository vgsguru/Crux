import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useState, useRef, useEffect, useMemo } from "react";
import { db, storage } from "@/integrations/firebase/client";
import { collection, doc, getDoc, getDocs, addDoc, query, where, orderBy, limit, startAfter } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/hooks/use-auth";
import { SiteNav } from "@/components/site-nav";
import { PostCard, PostCardSkeleton, type FeedPost } from "@/components/feed/PostCard";
import { Briefcase, Sparkles, ImagePlus, X, Loader2, Inbox, AlertTriangle, RotateCw, Send, Search } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteToApply } from "@/lib/messaging.server";
import { notifyMentions } from "@/lib/applications.server";
import { useMutation } from "@tanstack/react-query";
import { generatePostCaption } from "@/lib/ai.server";

const feedSearch = z.object({
  tab: fallback(z.enum(["jobs", "applicants"]), "jobs").default("jobs"),
});

export const Route = createFileRoute("/_authenticated/feed")({
  validateSearch: zodValidator(feedSearch),
  component: FeedPage,
});

const PAGE_SIZE = 10;

type Cursor = { score: number; created_at: string; id: string } | null;

async function loadFeedPage(viewerId: string, kind: "job" | "showcase", cursor: Cursor): Promise<{ posts: FeedPost[]; nextCursor: Cursor }> {
  // Both job and showcase posts live in the `posts` collection (job posts also
  // carry a `job_id` linking to the canonical job entity). We order by created_at
  // only (a single-field index that always exists) and filter by `kind` in JS, so
  // the feed works without a deployed composite index. Over-fetch to fill a page.
  const feedCol = collection(db, "posts");
  const queryConstraints: any[] = [orderBy("created_at", "desc")];
  if (cursor?.created_at) {
    queryConstraints.push(startAfter(cursor.created_at));
  }
  queryConstraints.push(limit(PAGE_SIZE * 4));

  const q = query(feedCol, ...queryConstraints);
  const snap = await getDocs(q);
  const fetched = snap.docs.map(d => ({ id: d.id, ...d.data(), score: 0 })) as Array<Omit<FeedPost, "author" | "company"> & { score: number }>;
  const lastFetched = fetched[fetched.length - 1];
  let kindRows = fetched.filter((r) => r.kind === kind);

  // Job posts whose job was closed/deleted shouldn't appear in the feed.
  if (kind === "job") {
    const checked = await Promise.all(kindRows.map(async (r) => {
      if (!r.job_id) return null;
      const js = await getDoc(doc(db, "jobs", r.job_id));
      return js.exists() && (js.data() as any).status === "active" ? r : null;
    }));
    kindRows = checked.filter(Boolean) as typeof kindRows;
  }
  const rows = kindRows.slice(0, PAGE_SIZE);

  const authorIds = [...new Set(rows.map((r) => r.author_id).filter(Boolean))];
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean) as string[])];
  
  const pmap = new Map();
  for (const id of authorIds) {
    const s = await getDoc(doc(db, "profiles", id));
    if (s.exists()) pmap.set(s.id, { id: s.id, ...s.data() });
  }

  const cmap = new Map();
  for (const id of companyIds) {
    const s = await getDoc(doc(db, "companies", id));
    if (s.exists()) cmap.set(s.id, { id: s.id, ...s.data() });
  }

  // Resolve which posts the viewer already liked (like ids are deterministic).
  const likedSet = new Set<string>();
  await Promise.all(
    rows.map(async (r) => {
      const likeSnap = await getDoc(doc(db, "post_likes", `${r.id}__${viewerId}`));
      if (likeSnap.exists()) likedSet.add(r.id);
    })
  );

  const posts: FeedPost[] = rows.map((r) => ({
    ...r,
    media_urls: Array.isArray(r.media_urls) ? r.media_urls : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    like_count: r.like_count ?? 0,
    comment_count: r.comment_count ?? 0,
    share_count: r.share_count ?? 0,
    viewer_liked: likedSet.has(r.id),
    author: pmap.get(r.author_id) ?? null,
    company: r.company_id ? cmap.get(r.company_id) ?? null : null,
  }));
  // Paginate on the raw (pre-filter) fetch so we don't skip posts. Stop when the
  // underlying query is exhausted (fewer than the over-fetch limit returned).
  const exhausted = fetched.length < PAGE_SIZE * 4;
  const nextCursor: Cursor = exhausted || !lastFetched
    ? null
    : { score: 0, created_at: lastFetched.created_at, id: lastFetched.id };
  return { posts, nextCursor };
}

function FeedPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const { user, isApplicant, isRecruiter } = useAuth();
  const kind = tab === "jobs" ? "job" : "showcase";

  const feedQuery = useInfiniteQuery({
    queryKey: ["feed", kind, user?.id],
    enabled: !!user,
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam }) => loadFeedPage(user!.id, kind, pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });

  const posts = useMemo(() => feedQuery.data?.pages.flatMap((p) => p.posts) ?? [], [feedQuery.data]);

  // Companies the viewer follows — their posts are boosted to the top of the feed.
  const { data: followedIds } = useQuery({
    queryKey: ["my-follows", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "follows"), where("user_id", "==", user!.id)));
      return new Set(snap.docs.map((d) => (d.data() as any).company_id as string));
    },
  });

  const [search, setSearch] = useState("");

  // People + companies directory for search (fetched once, filtered client-side).
  const { data: directory } = useQuery({
    queryKey: ["feed-directory"],
    enabled: search.trim().length > 0,
    queryFn: async () => {
      const [pSnap, cSnap] = await Promise.all([
        getDocs(query(collection(db, "profiles"), limit(200))),
        getDocs(query(collection(db, "companies"), limit(200))),
      ]);
      return {
        people: pSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as any),
        companies: cSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as any),
      };
    },
  });
  const q = search.trim().toLowerCase();
  const matchedPeople = q ? (directory?.people ?? []).filter((p: any) => (p.full_name || "").toLowerCase().includes(q) || (p.username || "").toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedCompanies = q ? (directory?.companies ?? []).filter((c: any) => (c.name || "").toLowerCase().includes(q)).slice(0, 6) : [];

  const visiblePosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q ? posts : posts.filter((p: any) => {
      const hay = [
        p.title, p.body, (p.tags ?? []).join(" "), (p.mentions ?? []).join(" "),
        p.author?.full_name, p.author?.username, p.company?.name, p.location,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    // Boost followed-company posts to the top (stable sort keeps recency within groups).
    if (followedIds && followedIds.size) {
      return [...base].sort((a: any, b: any) => {
        const af = a.company_id && followedIds.has(a.company_id) ? 1 : 0;
        const bf = b.company_id && followedIds.has(b.company_id) ? 1 : 0;
        return bf - af;
      });
    }
    return base;
  }, [posts, search, followedIds]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
        feedQuery.fetchNextPage();
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [feedQuery.hasNextPage, feedQuery.isFetchingNextPage, feedQuery.fetchNextPage]);

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="font-display text-3xl font-bold tracking-tight">Feed</h1>
          <div className="glass inline-flex rounded-full p-1 text-xs">
            <button
              onClick={() => navigate({ to: "/feed", search: { tab: "jobs" } })}
              className={`rounded-full px-4 py-1.5 transition ${tab === "jobs" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Briefcase className="mr-1 inline h-3.5 w-3.5" /> Jobs
            </button>
            <button
              onClick={() => navigate({ to: "/feed", search: { tab: "applicants" } })}
              className={`rounded-full px-4 py-1.5 transition ${tab === "applicants" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Sparkles className="mr-1 inline h-3.5 w-3.5" /> Applicants
            </button>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "jobs" ? "Search jobs by role, company, skills, location…" : "Search projects, people, tags…"}
            className="w-full rounded-full border border-border bg-background/60 py-2.5 pl-11 pr-4 text-sm outline-none focus:border-foreground/30"
          />
        </div>

        {q && (matchedPeople.length > 0 || matchedCompanies.length > 0) && (
          <div className="mb-4 space-y-1.5 rounded-3xl border border-border bg-background/40 p-2">
            <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">People &amp; companies</p>
            {matchedPeople.map((p: any) => (
              <Link
                key={`u-${p.id}`}
                to={p.username ? "/$username" : "/profile/$userId"}
                params={p.username ? { username: p.username } : { userId: p.id }}
                className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-secondary/60"
              >
                {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-medium">{(p.full_name || "?").slice(0, 1).toUpperCase()}</div>}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.full_name || "User"}</p>
                  {p.username && <p className="truncate text-xs text-muted-foreground">@{p.username}</p>}
                </div>
              </Link>
            ))}
            {matchedCompanies.map((c: any) => (
              <Link
                key={`c-${c.id}`}
                to="/profile/$userId"
                params={{ userId: c.owner_id }}
                className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-secondary/60"
              >
                {c.logo_url ? <img src={c.logo_url} alt="" className="h-9 w-9 rounded-xl object-cover" /> : <div className="grid h-9 w-9 place-items-center rounded-xl bg-secondary"><Briefcase className="h-4 w-4" /></div>}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">Company</p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {tab === "jobs" && isRecruiter && (
          <div className="mb-4 glass-strong rounded-3xl p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Posting a job automatically shares it to this feed.</p>
              <Link to="/recruiter/jobs/new" className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90">Post a job</Link>
            </div>
          </div>
        )}

        {tab === "applicants" && isRecruiter && (
          <RecruiterHeadhuntBanner />
        )}
        {tab === "applicants" && isApplicant && (
          <ShowcaseComposer onPosted={() => feedQuery.refetch()} />
        )}

        {feedQuery.isLoading && (
          <div className="space-y-4">
            <PostCardSkeleton />
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        )}

        {feedQuery.isError && posts.length === 0 && (
          <ErrorRetry
            message={(feedQuery.error as Error)?.message ?? "Couldn't load the feed."}
            onRetry={() => feedQuery.refetch()}
            busy={feedQuery.isFetching}
          />
        )}

        <div className="space-y-4">
          {visiblePosts.map((p) => <PostCard key={p.id} post={p} onChange={() => feedQuery.refetch()} />)}
          {search.trim() && visiblePosts.length === 0 && posts.length > 0 && (
            <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground">No matches for “{search}”.</div>
          )}
          {!feedQuery.isLoading && !feedQuery.isError && posts.length === 0 && (
            <div className="glass rounded-3xl p-12 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-secondary text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-semibold">
                {tab === "jobs" ? "No jobs yet" : "No projects yet"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {tab === "jobs"
                  ? "Job posts will appear here as recruiters publish them."
                  : "Be the first to share a project with the community."}
              </p>
            </div>
          )}
        </div>

        <div ref={sentinelRef} className="h-10" />
        {feedQuery.isFetchingNextPage && (
          <div className="mt-4 space-y-4">
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        )}
        {feedQuery.isError && posts.length > 0 && (
          <div className="mt-4">
            <ErrorRetry
              message="Couldn't load more posts."
              onRetry={() => feedQuery.fetchNextPage()}
              busy={feedQuery.isFetchingNextPage}
              compact
            />
          </div>
        )}
        {!feedQuery.hasNextPage && !feedQuery.isError && posts.length >= PAGE_SIZE && (
          <div className="py-6 text-center text-xs text-muted-foreground">You're all caught up</div>
        )}
      </main>
    </div>
  );
}

function RecruiterHeadhuntBanner() {
  const { user } = useAuth();
  const inviteFn = useServerFn(inviteToApply);
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    if (!user || !open) return;
    (async () => {
      const q = query(collection(db, "jobs"), where("status", "==", "active"), orderBy("created_at", "desc"), limit(20));
      const snap = await getDocs(q);
      setJobs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    })();
  }, [user, open]);

  const send = useMutation({
    mutationFn: async () => inviteFn({ data: { targetUserId, jobId, note: note || undefined } }),
    onSuccess: () => { toast.success("Invitation sent!"); setOpen(false); setTargetUserId(""); setJobId(""); setNote(""); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="mb-4 glass-strong rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Headhunt a candidate</p>
          <p className="text-xs text-muted-foreground">Browse showcases and invite standout talent directly to your open roles.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <Send className="h-3.5 w-3.5" /> Invite
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="glass-strong w-full max-w-md rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Invite to Apply</h2>
              <button onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Candidate's User ID</label>
                <input
                  value={targetUserId}
                  onChange={e => setTargetUserId(e.target.value)}
                  placeholder="Paste user ID from their profile"
                  className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Select Job</label>
                <select
                  value={jobId}
                  onChange={e => setJobId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                >
                  <option value="">— Choose a role —</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Personal Note (optional)</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Why do you think they'd be a great fit?"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                />
              </div>
            </div>
            <button
              disabled={!targetUserId.trim() || !jobId || send.isPending}
              onClick={() => send.mutate()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {send.isPending ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ErrorRetry({ message, onRetry, busy, compact }: { message: string; onRetry: () => void; busy?: boolean; compact?: boolean }) {
  return (
    <div className={`glass flex flex-col items-center gap-2 rounded-3xl text-center ${compact ? "p-4" : "p-8"}`}>
      <div className="grid h-9 w-9 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium">Something went wrong</p>
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        disabled={busy}
        className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
        {busy ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

function ShowcaseComposer({ onPosted }: { onPosted: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [media, setMedia] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiCaption, setAiCaption] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const genCaptionFn = useServerFn(generatePostCaption);
  const notifyMentionsFn = useServerFn(notifyMentions);

  async function uploadFile(file: File) {
    if (!user) return;
    if (file.size > 8 * 1024 * 1024) { toast.error("Max 8 MB"); return; }
    setUploading(true);
    try {
      const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
      const storageRef = ref(storage, `showcase-media/${path}`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const signedUrl = await getDownloadURL(storageRef);
      setMedia((m) => [...m, signedUrl]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleAiCaption() {
    if (!title.trim()) { toast.error("Enter a project title first"); return; }
    setAiCaption(true);
    try {
      const res = await genCaptionFn({ data: { title, existingBody: body } });
      if (res.caption) setBody(res.caption);
      toast.success("AI caption generated!");
    } catch (e: any) { toast.error(e.message); }
    finally { setAiCaption(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !title.trim() || busy) return;
    const tags = tagsInput.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean).slice(0, 8);
    // Extract @mentions from the body so they're searchable / linkable.
    const mentions = [...new Set((body.match(/@([a-zA-Z0-9_]{3,24})/g) ?? []).map((m) => m.slice(1).toLowerCase()))].slice(0, 20);
    setBusy(true);
    try {
      const ref = await addDoc(collection(db, "posts"), {
        kind: "showcase",
        author_id: user.id,
        title: title.trim().slice(0, 140),
        body: body.trim().slice(0, 2000),
        media_urls: media,
        tags,
        mentions,
        created_at: new Date().toISOString()
      });
      // Notify mentioned people (server resolves @handles → users).
      if (mentions.length) notifyMentionsFn({ data: { handles: mentions, postId: ref.id, postTitle: title.trim().slice(0, 140) } }).catch(() => {});
    } catch (error: any) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    setBusy(false);
    toast.success("Posted");
    setTitle(""); setBody(""); setTagsInput(""); setMedia([]);
    onPosted();
  }

  return (
    <form onSubmit={submit} className="mb-4 glass-strong space-y-3 rounded-3xl p-5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Project title"
        maxLength={140}
        required
        className="w-full rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm font-medium outline-none focus:border-foreground/30"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you build? Use @username to mention people and #tags…"
        rows={3}
        maxLength={2000}
        className="w-full resize-none rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
      />
      <input
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="Tags (comma separated, max 8) e.g. react, design, ml"
        className="w-full rounded-2xl border border-border bg-background/60 px-4 py-2 text-xs outline-none focus:border-foreground/30"
      />

      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {media.map((u, i) => (
            <div key={u} className="relative aspect-video overflow-hidden rounded-xl">
              <img src={u} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => setMedia(media.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-background/80 hover:bg-background">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || media.length >= 4}
            className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Add image
          </button>
          <button
            type="button"
            onClick={handleAiCaption}
            disabled={aiCaption}
            className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-secondary/60 disabled:opacity-50 text-primary"
          >
            {aiCaption ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI Caption
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
        />
        <button disabled={busy || !title.trim()} className="rounded-full bg-primary px-5 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? "Posting…" : "Share project"}
        </button>
      </div>
    </form>
  );
}
