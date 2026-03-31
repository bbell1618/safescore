-- The subscriptions.upsert calls in billing/sync and billing/webhook use
-- onConflict: "client_id", which requires a unique constraint to exist.
-- Without this constraint PostgreSQL rejects the upsert and silently fails.
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_client_id_unique UNIQUE (client_id);
