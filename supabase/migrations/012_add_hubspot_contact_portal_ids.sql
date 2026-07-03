-- Migration: Add HubSpot contact and portal association IDs to calls table
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS hubspot_contact_id text;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS hubspot_portal_id text;
