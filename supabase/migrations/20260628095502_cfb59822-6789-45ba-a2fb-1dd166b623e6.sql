
-- 1. question_bank
CREATE TABLE public.question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  text text NOT NULL,
  expected_signal text,
  tags text[] NOT NULL DEFAULT '{}',
  difficulty text NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_bank TO authenticated;
GRANT ALL ON public.question_bank TO service_role;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qb_owner_all" ON public.question_bank FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER qb_updated_at BEFORE UPDATE ON public.question_bank FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. interview_templates
CREATE TABLE public.interview_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  rubric jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_templates TO authenticated;
GRANT ALL ON public.interview_templates TO service_role;
ALTER TABLE public.interview_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tpl_owner_all" ON public.interview_templates FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER tpl_updated_at BEFORE UPDATE ON public.interview_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. interview_template_questions
CREATE TABLE public.interview_template_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.interview_templates(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  text_override text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_template_questions TO authenticated;
GRANT ALL ON public.interview_template_questions TO service_role;
ALTER TABLE public.interview_template_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tplq_owner_all" ON public.interview_template_questions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.interview_templates t WHERE t.id = template_id AND t.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.interview_templates t WHERE t.id = template_id AND t.owner_id = auth.uid()));
CREATE INDEX idx_tplq_template ON public.interview_template_questions(template_id, position);

-- 4. notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_owner_read" ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notif_owner_update" ON public.notifications FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX idx_notif_user ON public.notifications(user_id, created_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 5. message_templates
CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'custom',
  subject text NOT NULL,
  body_md text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mt_owner_all" ON public.message_templates FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TRIGGER mt_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. application_messages
CREATE TABLE public.application_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  sent_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.application_messages TO authenticated;
GRANT ALL ON public.application_messages TO service_role;
ALTER TABLE public.application_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "am_recruiter_read" ON public.application_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id JOIN public.companies c ON c.id=j.company_id WHERE a.id = application_id AND c.owner_id = auth.uid()));
CREATE POLICY "am_applicant_read" ON public.application_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.applicant_id = auth.uid()));
CREATE POLICY "am_sender_insert" ON public.application_messages FOR INSERT WITH CHECK (sent_by = auth.uid());

-- 7. Add columns
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS resume_match jsonb;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS interview_mode text NOT NULL DEFAULT 'async';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS interview_template_id uuid REFERENCES public.interview_templates(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS interview_mode text NOT NULL DEFAULT 'async';
ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'async';
ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 8. Profile email function for messaging
CREATE OR REPLACE FUNCTION public.get_applicant_email(_application_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.email::text FROM public.applications a
  JOIN auth.users u ON u.id = a.applicant_id
  JOIN public.jobs j ON j.id = a.job_id
  JOIN public.companies c ON c.id = j.company_id
  WHERE a.id = _application_id AND c.owner_id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.get_applicant_email(uuid) TO authenticated;

-- 9. Helper: candidate ranking percentile
CREATE OR REPLACE FUNCTION public.application_percentile(_application_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ctx AS (
    SELECT job_id, score FROM public.applications WHERE id = _application_id
  ),
  ranks AS (
    SELECT score FROM public.applications WHERE job_id = (SELECT job_id FROM ctx) AND score IS NOT NULL
  )
  SELECT CASE WHEN (SELECT count(*) FROM ranks) = 0 OR (SELECT score FROM ctx) IS NULL
    THEN NULL
    ELSE ROUND(100.0 * (SELECT count(*) FROM ranks r WHERE r.score <= (SELECT score FROM ctx)) / (SELECT count(*) FROM ranks), 0)
  END
$$;
GRANT EXECUTE ON FUNCTION public.application_percentile(uuid) TO authenticated;
