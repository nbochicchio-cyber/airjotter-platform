CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, avatar_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS boards (
 id UUID PRIMARY KEY, room_code VARCHAR(9) UNIQUE NOT NULL, owner_user_id UUID NOT NULL REFERENCES users(id), title TEXT NOT NULL DEFAULT 'Jotter senza titolo', revision BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS board_members (
 board_id UUID REFERENCES boards(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','viewer','editor')), status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','denied','revoked')), PRIMARY KEY(board_id,user_id)
);
CREATE TABLE IF NOT EXISTS access_requests (
 id UUID PRIMARY KEY, board_id UUID REFERENCES boards(id) ON DELETE CASCADE, requester_user_id UUID REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request ON access_requests(board_id,requester_user_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS board_operations (
 board_id UUID REFERENCES boards(id) ON DELETE CASCADE, revision BIGINT NOT NULL, operation_id UUID NOT NULL, user_id UUID REFERENCES users(id), operation_type TEXT NOT NULL, payload JSONB NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(board_id,revision), UNIQUE(operation_id)
);
CREATE INDEX IF NOT EXISTS board_operations_lookup ON board_operations(board_id,revision);

ALTER TABLE board_operations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE boards ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;
UPDATE boards SET content_updated_at = updated_at WHERE content_updated_at IS NULL;
ALTER TABLE boards ALTER COLUMN content_updated_at SET DEFAULT now();
ALTER TABLE boards ALTER COLUMN content_updated_at SET NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT 'free' CHECK(plan_code IN ('free','plus','ultra','unlimited'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS login_events (id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS login_events_created_idx ON login_events(created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_user_idx ON login_events(user_id,created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_code_check;
ALTER TABLE users ADD CONSTRAINT users_plan_code_check CHECK(plan_code IN ('free','plus','ultra','unlimited'));
UPDATE users SET plan_code='unlimited' WHERE lower(email)='nbochicchio@gmail.com';

ALTER TABLE boards ADD COLUMN IF NOT EXISTS empty_cleanup_after TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS boards_empty_cleanup_idx ON boards(empty_cleanup_after) WHERE empty_cleanup_after IS NOT NULL;

-- v14.2: la FK board_operations.user_id -> users.id non aveva ON DELETE SET NULL,
-- percio' la DELETE utente falliva se l'utente era stato editor su Jotter di altri.
ALTER TABLE board_operations DROP CONSTRAINT IF EXISTS board_operations_user_id_fkey;
ALTER TABLE board_operations ADD CONSTRAINT board_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
