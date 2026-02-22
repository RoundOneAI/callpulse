-- Add file_path column to calls table for generating signed storage URLs
-- file_url stores the public URL (not useful for private buckets)
-- file_path stores the storage path like "companyId/timestamp_filename.mp3"

alter table calls add column if not exists file_path text;
