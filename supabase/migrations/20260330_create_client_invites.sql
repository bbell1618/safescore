CREATE TABLE IF NOT EXISTS public.client_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email text NOT NULL,
  token uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Index for fast token lookups
CREATE INDEX idx_client_invites_token ON public.client_invites(token);

-- RLS: Only service role can read/write (all invite operations go through API routes)
ALTER TABLE public.client_invites ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed -- all access is via service role in API routes
