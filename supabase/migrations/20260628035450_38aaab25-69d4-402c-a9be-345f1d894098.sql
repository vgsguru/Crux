
CREATE TYPE public.pipeline_stage AS ENUM ('applied','interviewed','shortlisted','offer','rejected');

ALTER TABLE public.applications
  ADD COLUMN pipeline_status public.pipeline_stage NOT NULL DEFAULT 'applied',
  ADD COLUMN ai_highlights jsonb;

ALTER TABLE public.jobs
  ADD COLUMN og_image_url text;
