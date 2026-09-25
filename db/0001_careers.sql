CREATE TABLE IF NOT EXISTS career_applications (
 id uuid PRIMARY KEY, first_name text NOT NULL, last_name text NOT NULL,
 phone text NOT NULL, email text NOT NULL, role text NOT NULL,
 upload_hash text NOT NULL, upload_expires timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS career_applications_submitted ON career_applications(submitted_at DESC) WHERE submitted_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS career_media (
 id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
 name text NOT NULL, mime text NOT NULL, size integer NOT NULL CHECK(size > 0 AND size <= 10485760),
 parts integer NOT NULL CHECK(parts BETWEEN 1 AND 10)
);
CREATE TABLE IF NOT EXISTS career_chunks (
 media_id uuid NOT NULL REFERENCES career_media(id) ON DELETE CASCADE,
 part integer NOT NULL CHECK(part BETWEEN 0 AND 9), data bytea NOT NULL,
 PRIMARY KEY(media_id, part)
);
CREATE TABLE IF NOT EXISTS career_sessions (
 token_hash text PRIMARY KEY, code_version text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS career_limits (
 key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
