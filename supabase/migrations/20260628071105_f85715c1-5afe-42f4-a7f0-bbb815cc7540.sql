
-- Cursor-based ranked feed pagination.
CREATE OR REPLACE FUNCTION public.rank_feed(
  _viewer uuid,
  _kind post_kind,
  _limit integer DEFAULT 20,
  _cursor_score numeric DEFAULT NULL,
  _cursor_created_at timestamptz DEFAULT NULL,
  _cursor_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, kind post_kind, author_id uuid, company_id uuid, job_id uuid,
  title text, body text, media_urls jsonb, tags text[],
  like_count integer, comment_count integer, share_count integer,
  created_at timestamptz, score numeric, viewer_liked boolean
)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH viewer_tags AS (
    SELECT DISTINCT unnest(p.tags) AS tag
    FROM public.post_likes l JOIN public.posts p ON p.id = l.post_id
    WHERE l.user_id = _viewer
  ),
  base AS (
    SELECT p.*,
      EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 AS age_hours,
      (SELECT count(*) FROM viewer_tags v WHERE v.tag = ANY(p.tags)) AS tag_match,
      EXISTS(SELECT 1 FROM public.post_likes pl WHERE pl.post_id = p.id AND pl.user_id = _viewer) AS viewer_liked
    FROM public.posts p
    WHERE p.kind = _kind
  ),
  scored AS (
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
  )
  SELECT * FROM scored
  WHERE _cursor_score IS NULL
     OR (score, created_at, id) < (_cursor_score, _cursor_created_at, _cursor_id)
  ORDER BY score DESC, created_at DESC, id DESC
  LIMIT _limit
$$;
