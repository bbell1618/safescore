-- SafeScore Alpha Fix — Batch 1
-- Adds 'onboarding' to client_status enum so new clients default to onboarding
-- instead of jumping straight to 'active' before they've set up their account.

ALTER TYPE client_status ADD VALUE IF NOT EXISTS 'onboarding' BEFORE 'prospect';
