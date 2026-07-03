-- Add allow_sdr_view_all settings column to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS allow_sdr_view_all boolean DEFAULT false;
