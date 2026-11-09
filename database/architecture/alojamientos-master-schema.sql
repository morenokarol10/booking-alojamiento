-- Reference bootstrap for the RDA2 accommodations vertical.
-- Run with psql as a role allowed to create databases:
--   psql -d postgres -v ON_ERROR_STOP=1 -f database/architecture/alojamientos-master-schema.sql
-- Each database is owned by the role executing this script. Grant runtime
-- credentials only the privileges required by their own service database.
--
-- hotel_id, room_type_id, room_unit_id, order_id, and quote_id are logical
-- UUID references across databases. Deliberately do not add cross-database FKs.

\set ON_ERROR_STOP on

SELECT format('CREATE DATABASE %I', db_name)
FROM (VALUES
  ('ms_catalog_db'),
  ('ms_rooms_db'),
  ('ms_inventory_db'),
  ('ms_orders_db'),
  ('ms_reception_db'),
  ('ms_pricing_db'),
  ('ms_housekeeping_db')
) AS databases(db_name)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = db_name
)
\gexec

\connect ms_catalog_db

CREATE TABLE IF NOT EXISTS hotels (
  hotel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alojamiento_id VARCHAR(200) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  destination VARCHAR(80) NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'EC',
  address VARCHAR(200) NOT NULL,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  timezone TEXT NOT NULL DEFAULT 'America/Guayaquil'
    CHECK (timezone IN ('America/Guayaquil', 'Pacific/Galapagos')),
  checkin_time TIME NOT NULL DEFAULT TIME '14:00',
  checkout_time TIME NOT NULL DEFAULT TIME '11:00',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (alojamiento_id ~ '^HTL-[A-Z0-9-]{3,190}$'),
  CHECK (checkin_time = TIME '14:00'),
  CHECK (checkout_time = TIME '11:00')
);

CREATE TABLE IF NOT EXISTS hotel_photos (
  photo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position SMALLINT NOT NULL CHECK (position >= 0),
  UNIQUE (hotel_id, position)
);

CREATE TABLE IF NOT EXISTS hotel_amenities (
  hotel_id UUID NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
  amenity_code VARCHAR(60) NOT NULL,
  PRIMARY KEY (hotel_id, amenity_code)
);

CREATE INDEX IF NOT EXISTS hotels_catalog_idx
  ON hotels (destination, stars, status);

\connect ms_rooms_db

CREATE TABLE IF NOT EXISTS room_types (
  room_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  code VARCHAR(40) NOT NULL
    CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  adult_capacity SMALLINT NOT NULL CHECK (adult_capacity BETWEEN 1 AND 20),
  child_capacity SMALLINT NOT NULL DEFAULT 0
    CHECK (child_capacity BETWEEN 0 AND 10),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, code),
  UNIQUE (hotel_id, room_type_id)
);

CREATE TABLE IF NOT EXISTS room_units (
  room_unit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  unit_code VARCHAR(40) NOT NULL,
  floor_label VARCHAR(20),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, unit_code),
  UNIQUE (room_unit_id, hotel_id, room_type_id),
  FOREIGN KEY (hotel_id, room_type_id)
    REFERENCES room_types(hotel_id, room_type_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS room_types_hotel_active_idx
  ON room_types (hotel_id, active);

\connect ms_inventory_db

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Local projection of physical units, populated from ms_rooms events.
CREATE TABLE IF NOT EXISTS inventory_units (
  room_unit_id UUID PRIMARY KEY,
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  source_version BIGINT NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_unit_id, hotel_id, room_type_id)
);

CREATE TABLE IF NOT EXISTS hotel_inventory_policy (
  hotel_id UUID PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/Guayaquil'
    CHECK (timezone IN ('America/Guayaquil', 'Pacific/Galapagos')),
  checkin_time TIME NOT NULL DEFAULT TIME '14:00'
    CHECK (checkin_time = TIME '14:00'),
  checkout_time TIME NOT NULL DEFAULT TIME '11:00'
    CHECK (checkout_time = TIME '11:00'),
  turnover_buffer_minutes INTEGER NOT NULL
    CHECK (turnover_buffer_minutes BETWEEN 0 AND 1440),
  policy_version BIGINT NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_inventory (
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  inventory_date DATE NOT NULL,
  total_units_override INTEGER CHECK (total_units_override >= 0),
  blocked_units INTEGER NOT NULL DEFAULT 0 CHECK (blocked_units >= 0),
  closed_to_arrival BOOLEAN NOT NULL DEFAULT false,
  closed_to_departure BOOLEAN NOT NULL DEFAULT false,
  stop_sell BOOLEAN NOT NULL DEFAULT false,
  minimum_stay SMALLINT CHECK (minimum_stay IS NULL OR minimum_stay > 0),
  maximum_stay SMALLINT CHECK (maximum_stay IS NULL OR maximum_stay > 0),
  minimum_lead_hours INTEGER NOT NULL DEFAULT 0
    CHECK (minimum_lead_hours >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, room_type_id, inventory_date),
  CHECK (
    minimum_stay IS NULL OR maximum_stay IS NULL
    OR minimum_stay <= maximum_stay
  )
);

CREATE TABLE IF NOT EXISTS unit_blocks (
  block_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  room_unit_id UUID NOT NULL,
  blocked_period TSTZRANGE NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('MAINTENANCE', 'CLEANING', 'OUT_OF_SERVICE', 'MANUAL')),
  source_reference UUID,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT isempty(blocked_period)),
  FOREIGN KEY (room_unit_id, hotel_id, room_type_id)
    REFERENCES inventory_units(room_unit_id, hotel_id, room_type_id)
    ON DELETE RESTRICT,
  CONSTRAINT unit_blocks_no_overlap
    EXCLUDE USING gist (room_unit_id WITH =, blocked_period WITH &&)
    WHERE (active)
);

CREATE TABLE IF NOT EXISTS inventory_allocations (
  allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  room_unit_id UUID NOT NULL,
  order_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  checkin_date DATE NOT NULL,
  checkout_date DATE NOT NULL,
  unavailable_period TSTZRANGE NOT NULL,
  state TEXT NOT NULL DEFAULT 'HELD'
    CHECK (state IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'RELEASED', 'EXPIRED')),
  hold_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (checkout_date > checkin_date),
  CHECK (NOT isempty(unavailable_period)),
  FOREIGN KEY (room_unit_id, hotel_id, room_type_id)
    REFERENCES inventory_units(room_unit_id, hotel_id, room_type_id)
    ON DELETE RESTRICT,
  CONSTRAINT inventory_allocations_no_overlap
    EXCLUDE USING gist (room_unit_id WITH =, unavailable_period WITH &&)
    WHERE (state IN ('HELD', 'CONFIRMED', 'CHECKED_IN'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_order_unit_uidx
  ON inventory_allocations (order_id, room_unit_id)
  WHERE (state IN ('HELD', 'CONFIRMED', 'CHECKED_IN'));
CREATE INDEX IF NOT EXISTS inventory_allocations_dates_idx
  ON inventory_allocations (hotel_id, room_type_id, checkin_date, checkout_date)
  WHERE (state IN ('HELD', 'CONFIRMED', 'CHECKED_IN'));
CREATE INDEX IF NOT EXISTS daily_inventory_date_idx
  ON daily_inventory (hotel_id, inventory_date, room_type_id);

-- PushStockUpdate sends an absolute availability snapshot for each affected
-- hotel-night slot. The message has no event_id: timestamp ordering plus the
-- outbox key prevent an older snapshot from replacing a newer one.
CREATE TABLE IF NOT EXISTS stock_update_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL DEFAULT 'alojamientos',
  item_id TEXT NOT NULL,
  inventory_date DATE NOT NULL,
  time_slot TIME NOT NULL DEFAULT TIME '14:00'
    CHECK (time_slot = TIME '14:00'),
  slot_id TEXT NOT NULL,
  available_units INTEGER NOT NULL CHECK (available_units >= 0),
  -- Unix epoch milliseconds, as specified by inventory.proto.
  event_timestamp BIGINT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_state IN (
      'PENDING', 'DELIVERED', 'STALE_TIMESTAMP_IGNORED', 'RETRY'
    )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ack_success BOOLEAN,
  ack_error_code TEXT,
  ack_current_available INTEGER
    CHECK (ack_current_available IS NULL OR ack_current_available >= 0),
  ack_processed_at BIGINT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, item_id, inventory_date, time_slot, slot_id, event_timestamp),
  CHECK (item_id ~ '^HTL-[A-Z0-9-]+:[A-Z0-9_]{2,40}$'),
  CHECK (slot_id ~ '^slot-[0-9]{8}-[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS stock_update_outbox_pending_idx
  ON stock_update_outbox (next_attempt_at, created_at)
  WHERE (delivery_state IN ('PENDING', 'RETRY'));

-- Local last-known snapshot supports monotonic timestamps, ACK reconciliation,
-- and the contract's GetSlotAvailability query. Booking remains the receiver.
CREATE TABLE IF NOT EXISTS inventory_sync_state (
  service_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  inventory_date DATE NOT NULL,
  time_slot TIME NOT NULL DEFAULT TIME '14:00'
    CHECK (time_slot = TIME '14:00'),
  slot_id TEXT NOT NULL
    CHECK (slot_id ~ '^slot-[0-9]{8}-[0-9]{4}$'),
  last_published_timestamp BIGINT NOT NULL,
  last_published_available INTEGER NOT NULL
    CHECK (last_published_available >= 0),
  booking_current_available INTEGER
    CHECK (booking_current_available IS NULL OR booking_current_available >= 0),
  last_ack_error_code TEXT,
  last_ack_processed_at BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, item_id, inventory_date, time_slot, slot_id),
  CHECK (item_id ~ '^HTL-[A-Z0-9-]+:[A-Z0-9_]{2,40}$')
);

-- StreamInventoryChanges carries deltas with an event_id for deduplication.
-- Do not publish the same stock mutation through both RPCs: the unary RPC is
-- the absolute-snapshot path; the stream is the delta path.
CREATE TABLE IF NOT EXISTS stock_change_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL DEFAULT 'alojamientos',
  item_id TEXT NOT NULL,
  inventory_date DATE NOT NULL,
  time_slot TIME NOT NULL DEFAULT TIME '14:00',
  slot_id TEXT NOT NULL
    CHECK (slot_id ~ '^slot-[0-9]{8}-[0-9]{4}$'),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  -- Unix epoch milliseconds, as specified by inventory.proto.
  event_timestamp BIGINT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_state IN ('PENDING', 'DELIVERED', 'RETRY')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\connect ms_pricing_db

CREATE TABLE IF NOT EXISTS hotel_tax_policy (
  hotel_id UUID PRIMARY KEY,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  iva_percent NUMERIC(5,2) NOT NULL DEFAULT 15.00
    CHECK (iva_percent = 15.00),
  municipal_per_room_night NUMERIC(11,2) NOT NULL DEFAULT 2.00
    CHECK (municipal_per_room_night = 2.00),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_plans (
  rate_plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  code VARCHAR(30) NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,30}$'),
  name VARCHAR(100) NOT NULL,
  meal_plan TEXT NOT NULL DEFAULT 'SOLO_HABITACION',
  refundable BOOLEAN NOT NULL DEFAULT true,
  cancellation_free_hours SMALLINT NOT NULL DEFAULT 48
    CHECK (cancellation_free_hours >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  base_price NUMERIC(11,2) NOT NULL CHECK (base_price >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE NOT NULL,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, room_type_id, code),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE IF NOT EXISTS nightly_rates (
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  rate_plan_id UUID NOT NULL REFERENCES rate_plans(rate_plan_id)
    ON DELETE CASCADE,
  rate_date DATE NOT NULL,
  price NUMERIC(11,2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  PRIMARY KEY (hotel_id, room_type_id, rate_plan_id, rate_date)
);

CREATE TABLE IF NOT EXISTS quotes (
  quote_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  rate_plan_id UUID NOT NULL,
  checkin_date DATE NOT NULL,
  checkout_date DATE NOT NULL,
  room_count SMALLINT NOT NULL CHECK (room_count BETWEEN 1 AND 10),
  adults SMALLINT NOT NULL CHECK (adults BETWEEN 1 AND 20),
  children SMALLINT NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 10),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  subtotal NUMERIC(11,2) NOT NULL CHECK (subtotal >= 0),
  iva_percent NUMERIC(5,2) NOT NULL DEFAULT 15.00
    CHECK (iva_percent = 15.00),
  iva_amount NUMERIC(11,2) NOT NULL CHECK (iva_amount >= 0),
  municipal_amount NUMERIC(11,2) NOT NULL CHECK (municipal_amount >= 0),
  discount_amount NUMERIC(11,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(11,2) NOT NULL CHECK (total_amount >= 0),
  breakdown JSONB NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (checkout_date > checkin_date),
  CHECK (discount_amount <= subtotal),
  CHECK (iva_amount = round(subtotal * iva_percent / 100, 2)),
  CHECK (municipal_amount =
    (checkout_date - checkin_date) * room_count * 2.00),
  CHECK (total_amount =
    subtotal + iva_amount + municipal_amount - discount_amount),
  CHECK (valid_until > created_at),
  CHECK (valid_until <= created_at + INTERVAL '30 minutes')
);

CREATE INDEX IF NOT EXISTS quotes_expiry_idx ON quotes (valid_until);

\connect ms_orders_db

CREATE TABLE IF NOT EXISTS orders (
  order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  quote_id UUID,
  external_order_id VARCHAR(30) NOT NULL UNIQUE
    CHECK (external_order_id ~ '^ORD-HTL-[A-Z0-9]{3,20}$'),
  reservation_code VARCHAR(30) NOT NULL UNIQUE
    CHECK (reservation_code ~ '^BK-HOTEL-[A-Z0-9]{3,20}$'),
  saga_id UUID,
  idempotency_key UUID NOT NULL,
  request_hash BYTEA NOT NULL,
  checkin_date DATE NOT NULL,
  checkout_date DATE NOT NULL,
  room_count SMALLINT NOT NULL CHECK (room_count BETWEEN 1 AND 10),
  adults SMALLINT NOT NULL CHECK (adults BETWEEN 1 AND 20),
  children SMALLINT NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 10),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED')),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  subtotal NUMERIC(11,2) NOT NULL CHECK (subtotal >= 0),
  iva_percent NUMERIC(5,2) NOT NULL DEFAULT 15.00
    CHECK (iva_percent = 15.00),
  iva_amount NUMERIC(11,2) NOT NULL CHECK (iva_amount >= 0),
  municipal_amount NUMERIC(11,2) NOT NULL CHECK (municipal_amount >= 0),
  discount_amount NUMERIC(11,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(11,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT,
  payment_reference VARCHAR(64),
  guest_name VARCHAR(120) NOT NULL,
  guest_email VARCHAR(120) NOT NULL,
  guest_phone VARCHAR(20) NOT NULL,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('CEDULA', 'RUC', 'PASAPORTE')),
  document_ciphertext BYTEA NOT NULL,
  document_last4 VARCHAR(4) NOT NULL,
  document_validated BOOLEAN NOT NULL CHECK (document_validated),
  guest_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  cancellation_policy JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (checkout_date > checkin_date),
  CHECK (iva_amount = round(subtotal * iva_percent / 100, 2)),
  CHECK (municipal_amount =
    (checkout_date - checkin_date) * room_count * 2.00),
  CHECK (discount_amount <= subtotal),
  CHECK (total_amount =
    subtotal + iva_amount + municipal_amount - discount_amount),
  CHECK (idempotency_key::TEXT ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS order_idempotency (
  idempotency_key UUID PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'CANCEL')),
  request_hash BYTEA NOT NULL,
  state TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
  response_status SMALLINT,
  response_body JSONB,
  order_id UUID REFERENCES orders(order_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at >= created_at + INTERVAL '24 hours'),
  CHECK (
    (state = 'IN_PROGRESS' AND response_status IS NULL)
    OR (state = 'COMPLETED' AND response_status IS NOT NULL
        AND response_body IS NOT NULL)
  ),
  CHECK (idempotency_key::TEXT ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);

-- Canonical document rules. Call at request validation time; do not persist
-- the plaintext document. The order stores only application-encrypted bytes.
CREATE OR REPLACE FUNCTION is_valid_ec_document(
  p_document_type TEXT,
  p_document TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  digit_value INTEGER;
  checksum_sum INTEGER := 0;
  position_index INTEGER;
  expected_check_digit INTEGER;
BEGIN
  IF p_document_type = 'CEDULA' THEN
    IF p_document !~ '^[0-9]{10}$' THEN
      RETURN false;
    END IF;
    FOR position_index IN 1..9 LOOP
      digit_value := substr(p_document, position_index, 1)::INTEGER;
      IF position_index % 2 = 1 THEN
        digit_value := digit_value * 2;
        IF digit_value > 9 THEN
          digit_value := digit_value - 9;
        END IF;
      END IF;
      checksum_sum := checksum_sum + digit_value;
    END LOOP;
    expected_check_digit := (10 - (checksum_sum % 10)) % 10;
    RETURN substr(p_document, 10, 1)::INTEGER = expected_check_digit;
  ELSIF p_document_type = 'RUC' THEN
    RETURN p_document ~ '^[0-9]{13}$';
  ELSIF p_document_type = 'PASAPORTE' THEN
    RETURN p_document ~* '^[A-Z0-9]{6,12}$';
  END IF;
  RETURN false;
END;
$$;

CREATE TABLE IF NOT EXISTS order_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('ORDER_CONFIRMED', 'ORDER_CANCELLED')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orders_hotel_dates_idx
  ON orders (hotel_id, checkin_date, checkout_date);
CREATE INDEX IF NOT EXISTS orders_saga_idx ON orders (saga_id)
  WHERE saga_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_idempotency_expiry_idx
  ON order_idempotency (expires_at);

\connect ms_reception_db

CREATE TABLE IF NOT EXISTS reception_operations (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  order_id UUID NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('CHECK_IN', 'CHECK_OUT')),
  operation_at TIMESTAMPTZ NOT NULL,
  permitted_from TIMESTAMPTZ NOT NULL,
  permitted_until TIMESTAMPTZ NOT NULL,
  early_checkin_authorized BOOLEAN NOT NULL DEFAULT false,
  authorized_by UUID,
  idempotency_key UUID NOT NULL UNIQUE,
  actor_id UUID NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, operation_type),
  CHECK (
    operation_type <> 'CHECK_IN'
    OR operation_at >= permitted_from
    OR (early_checkin_authorized AND authorized_by IS NOT NULL)
  ),
  CHECK (
    operation_type <> 'CHECK_OUT'
    OR operation_at <= permitted_until
  )
);

CREATE TABLE IF NOT EXISTS reception_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  order_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reception_order_history_idx
  ON reception_audit (hotel_id, order_id, occurred_at);

\connect ms_housekeeping_db

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS housekeeping_policy (
  hotel_id UUID PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/Guayaquil'
    CHECK (timezone IN ('America/Guayaquil', 'Pacific/Galapagos')),
  checkin_from TIME NOT NULL DEFAULT TIME '14:00'
    CHECK (checkin_from = TIME '14:00'),
  checkout_by TIME NOT NULL DEFAULT TIME '11:00'
    CHECK (checkout_by = TIME '11:00'),
  preparation_minutes INTEGER NOT NULL
    CHECK (preparation_minutes BETWEEN 0 AND 1440),
  policy_version BIGINT NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL,
  room_unit_id UUID NOT NULL,
  order_id UUID,
  task_type TEXT NOT NULL
    CHECK (task_type IN ('TURNOVER_CLEANING', 'DISINFECTION', 'INSPECTION', 'MAINTENANCE')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED')),
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to UUID,
  blocked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scheduled_end > scheduled_start),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT housekeeping_active_tasks_no_overlap
    EXCLUDE USING gist (
      room_unit_id WITH =,
      tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
    )
    WHERE (status IN ('ASSIGNED', 'IN_PROGRESS'))
);

CREATE INDEX IF NOT EXISTS housekeeping_due_idx
  ON housekeeping_tasks (hotel_id, status, scheduled_start);
CREATE INDEX IF NOT EXISTS housekeeping_unit_schedule_idx
  ON housekeeping_tasks (room_unit_id, scheduled_start, scheduled_end);
