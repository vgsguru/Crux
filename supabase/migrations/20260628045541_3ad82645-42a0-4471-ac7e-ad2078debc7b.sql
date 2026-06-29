
CREATE TYPE public.post_kind AS ENUM ('job', 'showcase');

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.post_kind NOT NULL,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  like_count int NOT NULL DEFAULT 0,
  comment_count int NOT NULL DEFAULT 0,
  share_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_kind_created_idx ON public.posts (kind, created_at DESC);
CREATE INDEX posts_author_idx ON public.posts (author_id);
CREATE INDEX posts_tags_idx ON public.posts USING gin (tags);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_read_auth" ON public.posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "posts_insert_job" ON public.posts FOR INSERT TO authenticated
  WITH CHECK (
    kind = 'job'
    AND author_id = auth.uid()
    AND public.has_role(auth.uid(), 'recruiter')
    AND company_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND c.owner_id = auth.uid())
  );
CREATE POLICY "posts_insert_showcase" ON public.posts FOR INSERT TO authenticated
  WITH CHECK (
    kind = 'showcase'
    AND author_id = auth.uid()
    AND public.has_role(auth.uid(), 'applicant')
  );
CREATE POLICY "posts_update_own" ON public.posts FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "posts_delete_own" ON public.posts FOR DELETE TO authenticated
  USING (author_id = auth.uid());

CREATE TRIGGER posts_updated_at BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.post_likes (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.post_likes TO authenticated;
GRANT ALL ON public.post_likes TO service_role;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "likes_read" ON public.post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "likes_insert_self" ON public.post_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "likes_delete_self" ON public.post_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.bump_like_count() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE public.posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN UPDATE public.posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER post_likes_count_trg AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.bump_like_count();

CREATE TABLE public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_comments_post_idx ON public.post_comments (post_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_comments TO authenticated;
GRANT ALL ON public.post_comments TO service_role;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_read" ON public.post_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert_self" ON public.post_comments FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments_update_own" ON public.post_comments FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments_delete_own" ON public.post_comments FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE OR REPLACE FUNCTION public.bump_comment_count() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE public.posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN UPDATE public.posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER post_comments_count_trg AFTER INSERT OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.bump_comment_count();

CREATE TABLE public.post_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_shares_post_idx ON public.post_shares (post_id);
GRANT SELECT, INSERT, DELETE ON public.post_shares TO authenticated;
GRANT ALL ON public.post_shares TO service_role;
ALTER TABLE public.post_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shares_read" ON public.post_shares FOR SELECT TO authenticated USING (true);
CREATE POLICY "shares_insert_self" ON public.post_shares FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "shares_delete_self" ON public.post_shares FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.bump_share_count() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE public.posts SET share_count = share_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN UPDATE public.posts SET share_count = GREATEST(share_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER post_shares_count_trg AFTER INSERT OR DELETE ON public.post_shares
  FOR EACH ROW EXECUTE FUNCTION public.bump_share_count();

-- Ranking function
CREATE OR REPLACE FUNCTION public.rank_feed(_viewer uuid, _kind public.post_kind, _limit int DEFAULT 20, _offset int DEFAULT 0)
RETURNS TABLE (
  id uuid, kind public.post_kind, author_id uuid, company_id uuid, job_id uuid,
  title text, body text, media_urls jsonb, tags text[],
  like_count int, comment_count int, share_count int,
  created_at timestamptz, score numeric, viewer_liked boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH viewer_tags AS (
    SELECT DISTINCT unnest(p.tags) AS tag
    FROM public.post_likes l JOIN public.posts p ON p.id = l.post_id
    WHERE l.user_id = _viewer
    UNION
    SELECT DISTINCT unnest(j.title || ARRAY[j.location, j.employment_type::text])
    FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
    WHERE a.applicant_id = _viewer AND a.created_at > now() - interval '90 days'
  ),
  base AS (
    SELECT p.*,
      EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 AS age_hours,
      (SELECT count(*) FROM viewer_tags v WHERE v.tag = ANY(p.tags)) AS tag_match,
      EXISTS(SELECT 1 FROM public.post_likes pl WHERE pl.post_id = p.id AND pl.user_id = _viewer) AS viewer_liked
    FROM public.posts p
    WHERE p.kind = _kind
  )
  SELECT id, kind, author_id, company_id, job_id, title, body, media_urls, tags,
    like_count, comment_count, share_count, created_at,
    (
      (log(1 + like_count + 2*comment_count + 3*share_count)
        * CASE WHEN age_hours < 6 THEN 1.5 ELSE 1.0 END
        + 0.4 * tag_match
        + CASE WHEN jsonb_array_length(media_urls) > 0 THEN 0.2 ELSE 0 END)
      * exp(- age_hours / 36.0)
    )::numeric AS score,
    viewer_liked
  FROM base
  ORDER BY score DESC, created_at DESC
  LIMIT _limit OFFSET _offset
$$;

GRANT EXECUTE ON FUNCTION public.rank_feed(uuid, public.post_kind, int, int) TO authenticated;
