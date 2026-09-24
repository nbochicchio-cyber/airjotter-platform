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


-- v15.6: stato persistente del Jotter vuoto, indipendente dal numero di pagine
ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_empty BOOLEAN NOT NULL DEFAULT true;
UPDATE boards b SET is_empty = EXISTS (
 SELECT 1
) WHERE false;
UPDATE boards b SET is_empty = NOT EXISTS (
 SELECT 1 FROM board_operations bo
 WHERE bo.board_id=b.id AND bo.is_active=true
 AND bo.operation_type IN ('command:add','stroke:add','text:add')
 AND bo.revision > COALESCE((SELECT max(c.revision) FROM board_operations c WHERE c.board_id=b.id AND c.is_active=true AND c.operation_type='board:clear'),0)
);
CREATE INDEX IF NOT EXISTS boards_owner_empty_idx ON boards(owner_user_id,is_empty);


-- AIRJOTTER BILLING V22.0
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_code_check;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_payer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_external_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS spot_jotters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS spot_pages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS spot_exports INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS billing_plans (
 id UUID PRIMARY KEY,
 code TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','suspended','archived')),
 billing_type TEXT NOT NULL DEFAULT 'subscription' CHECK(billing_type IN ('free','subscription','per_seat','consumable')),
 currency CHAR(3) NOT NULL DEFAULT 'EUR',
 amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_cents>=0),
 interval_unit TEXT CHECK(interval_unit IN ('month','year') OR interval_unit IS NULL),
 interval_count INTEGER NOT NULL DEFAULT 1 CHECK(interval_count>0),
 min_seats INTEGER NOT NULL DEFAULT 1 CHECK(min_seats>0),
 max_seats INTEGER,
 boards_limit INTEGER NOT NULL DEFAULT 1 CHECK(boards_limit>0),
 pages_limit INTEGER NOT NULL DEFAULT 3 CHECK(pages_limit>0),
 guests_limit INTEGER,
 exports_limit INTEGER,
 history_days INTEGER,
 included_spot_jotters INTEGER NOT NULL DEFAULT 0,
 included_spot_pages INTEGER NOT NULL DEFAULT 0,
 included_spot_exports INTEGER NOT NULL DEFAULT 0,
 features JSONB NOT NULL DEFAULT '[]'::jsonb,
 consumable_kind TEXT CHECK(consumable_kind IN ('jotter','page','export') OR consumable_kind IS NULL),
 consumable_units INTEGER NOT NULL DEFAULT 0,
 sort_order INTEGER NOT NULL DEFAULT 0,
 featured BOOLEAN NOT NULL DEFAULT false,
 public BOOLEAN NOT NULL DEFAULT true,
 stripe_product_id TEXT,
 stripe_price_id TEXT,
 paypal_product_id TEXT,
 paypal_plan_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_plans_public_idx ON billing_plans(status,public,sort_order);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_plan_id_fkey FOREIGN KEY(plan_id) REFERENCES billing_plans(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS billing_orders (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id UUID REFERENCES billing_plans(id),
 provider TEXT NOT NULL CHECK(provider IN ('stripe','paypal','admin')),
 kind TEXT NOT NULL CHECK(kind IN ('subscription','one_time')),
 external_id TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending',
 amount_cents INTEGER NOT NULL DEFAULT 0,
 currency CHAR(3) NOT NULL DEFAULT 'EUR',
 quantity INTEGER NOT NULL DEFAULT 1,
 raw JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_orders_user_idx ON billing_orders(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
 provider TEXT NOT NULL,
 external_event_id TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 payload JSONB NOT NULL,
 PRIMARY KEY(provider,external_event_id)
);

INSERT INTO billing_plans(id,code,name,description,status,billing_type,currency,amount_cents,interval_unit,boards_limit,pages_limit,features,sort_order,featured,public)
VALUES
 ('00000000-0000-4000-8000-000000000001','free','Free','Per iniziare','active','free','EUR',0,NULL,1,3,'["Ospiti illimitati"]',10,false,true),
 ('00000000-0000-4000-8000-000000000002','plus','Plus','Per uso personale avanzato','active','subscription','EUR',499,'month',3,7,'["Export PDF completo","Firma scontornata"]',20,true,true),
 ('00000000-0000-4000-8000-000000000003','ultra','Ultra','Per uso professionale','active','subscription','EUR',999,'month',10,20,'["Cronologia estesa"]',30,false,true),
 ('00000000-0000-4000-8000-000000000004','team-edu','Team & Edu','Per organizzazioni e formazione','draft','per_seat','EUR',799,'month',20,30,'["Console admin"]',40,false,true)
ON CONFLICT(code) DO NOTHING;

UPDATE users u SET plan_id=p.id FROM billing_plans p WHERE p.code=u.plan_code AND u.plan_id IS NULL;


-- AIRJOTTER V22.2 - CREDITO PAY PER USE
ALTER TABLE users ADD COLUMN IF NOT EXISTS spot_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(spot_credit_cents >= 0);
CREATE TABLE IF NOT EXISTS pay_use_settings (
 id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
 enabled BOOLEAN NOT NULL DEFAULT true,
 currency CHAR(3) NOT NULL DEFAULT 'EUR',
 minimum_topup_cents INTEGER NOT NULL DEFAULT 300 CHECK(minimum_topup_cents>=1),
 jotter_cost_cents INTEGER NOT NULL DEFAULT 100 CHECK(jotter_cost_cents>=1),
 page_cost_cents INTEGER NOT NULL DEFAULT 25 CHECK(page_cost_cents>=1),
 export_cost_cents INTEGER NOT NULL DEFAULT 50 CHECK(export_cost_cents>=1),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO pay_use_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS pay_use_transactions (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 transaction_type TEXT NOT NULL CHECK(transaction_type IN ('topup','spend','refund','admin_adjustment')),
 amount_cents INTEGER NOT NULL,
 item_type TEXT CHECK(item_type IN ('jotter','page','export','credit') OR item_type IS NULL),
 units INTEGER NOT NULL DEFAULT 0,
 provider TEXT,
 external_id TEXT,
 description TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_use_tx_external_idx ON pay_use_transactions(provider,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pay_use_tx_user_idx ON pay_use_transactions(user_id,created_at DESC);


-- AIRJOTTER V22.6 - EXTRA TEMPORANEI E SCADENZE
CREATE TABLE IF NOT EXISTS user_extra_entitlements (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('jotter','page')),
 board_id UUID REFERENCES boards(id) ON DELETE CASCADE,
 units INTEGER NOT NULL DEFAULT 1 CHECK(units > 0),
 source TEXT NOT NULL DEFAULT 'purchase' CHECK(source IN ('purchase','admin_gift','migration')),
 amount_cents INTEGER NOT NULL DEFAULT 0,
 starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '30 days'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 renewed_at TIMESTAMPTZ,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS user_extra_entitlements_user_idx ON user_extra_entitlements(user_id,expires_at);
CREATE INDEX IF NOT EXISTS user_extra_entitlements_board_idx ON user_extra_entitlements(board_id,kind,expires_at);
ALTER TABLE billing_plans ALTER COLUMN exports_limit SET DEFAULT 1;
UPDATE billing_plans SET exports_limit=1 WHERE code='free' AND exports_limit IS NULL;


-- AIRJOTTER V22.8.1 - ACQUISTI EXTRA IDEMPOTENTI E DETTAGLIO AMMINISTRATIVO
ALTER TABLE user_extra_entitlements ADD COLUMN IF NOT EXISTS page_from INTEGER;
ALTER TABLE user_extra_entitlements ADD COLUMN IF NOT EXISTS page_to INTEGER;
ALTER TABLE user_extra_entitlements ADD COLUMN IF NOT EXISTS purchase_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS user_extra_entitlements_purchase_request_idx
 ON user_extra_entitlements(purchase_request_id) WHERE purchase_request_id IS NOT NULL;


-- AIRJOTTER V22.8.2 - EXTRA COME CAPIENZA, NON COME JOTTER CONSUMATO
-- Ricostruisce esclusivamente acquisti Jotter ancora validi quando vecchie cancellazioni
-- a cascata hanno eliminato i relativi entitlement.
WITH active_purchase_totals AS (
 SELECT user_id,COALESCE(sum(units),0)::int purchased
 FROM pay_use_transactions
 WHERE transaction_type='spend' AND item_type='jotter'
   AND amount_cents<0 AND created_at>now()-interval '30 days'
 GROUP BY user_id
), active_entitlement_totals AS (
 SELECT user_id,COALESCE(sum(units),0)::int entitled
 FROM user_extra_entitlements
 WHERE kind='jotter' AND expires_at>now()
 GROUP BY user_id
), missing AS (
 SELECT p.user_id,GREATEST(0,p.purchased-COALESCE(e.entitled,0)) missing
 FROM active_purchase_totals p LEFT JOIN active_entitlement_totals e USING(user_id)
)
INSERT INTO user_extra_entitlements(id,user_id,kind,board_id,units,source,amount_cents,starts_at,expires_at,metadata)
SELECT gen_random_uuid(),m.user_id,'jotter',NULL,1,'migration',0,now(),now()+interval '30 days',jsonb_build_object('repair','v22.8.2')
FROM missing m CROSS JOIN LATERAL generate_series(1,m.missing);


-- AIRJOTTER V22.8.3 - PIANI CON CREDITO E STORICO DETTAGLIATO
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_purchased_at TIMESTAMPTZ;
ALTER TABLE pay_use_transactions DROP CONSTRAINT IF EXISTS pay_use_transactions_item_type_check;
ALTER TABLE pay_use_transactions ADD CONSTRAINT pay_use_transactions_item_type_check
 CHECK(item_type IN ('jotter','page','export','credit','plan') OR item_type IS NULL);
CREATE INDEX IF NOT EXISTS pay_use_tx_user_created_v2283_idx ON pay_use_transactions(user_id,created_at DESC);

-- AIRJOTTER V22.8.4 - RIEPILOGO PIANO E TRANSAZIONI USER FRIENDLY
