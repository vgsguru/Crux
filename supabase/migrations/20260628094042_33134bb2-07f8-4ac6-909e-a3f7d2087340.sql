
CREATE OR REPLACE FUNCTION public.bulk_update_pipeline(_application_ids uuid[], _new_status text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected int;
BEGIN
  IF _new_status NOT IN ('applied','interviewed','shortlisted','offer','rejected') THEN
    RAISE EXCEPTION 'Invalid status %', _new_status;
  END IF;
  UPDATE public.applications a
  SET pipeline_status = _new_status,
      audit_log = COALESCE(a.audit_log,'[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('at', now(), 'by', auth.uid(), 'action','bulk_status','to', _new_status))
  WHERE a.id = ANY(_application_ids)
    AND EXISTS (SELECT 1 FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
                WHERE j.id = a.job_id AND c.owner_id = auth.uid());
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END; $$;
