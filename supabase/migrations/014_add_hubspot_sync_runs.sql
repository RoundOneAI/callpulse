-- Migration: Add hubspot_sync_runs table to track imports
CREATE TABLE IF NOT EXISTS public.hubspot_sync_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL, -- 'success' | 'failed'
  imported_count integer NOT NULL DEFAULT 0,
  error_message text,
  run_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.hubspot_sync_runs ENABLE ROW LEVEL SECURITY;

-- Select policies
CREATE POLICY "Users see company sync logs" ON public.hubspot_sync_runs
  FOR SELECT USING (company_id = public.get_my_company_id());
