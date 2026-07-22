-- Assessment is the one-time diagnostic tier and must sort below subscriptions.
ALTER TYPE public.client_tier ADD VALUE IF NOT EXISTS 'assessment' BEFORE 'monitor';
