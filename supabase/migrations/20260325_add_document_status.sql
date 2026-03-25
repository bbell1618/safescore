-- Add document review status to documents table

DO $$ BEGIN
  CREATE TYPE document_review_status AS ENUM (
    'pending_review',
    'reviewed',
    'action_needed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS status document_review_status NOT NULL DEFAULT 'pending_review';
