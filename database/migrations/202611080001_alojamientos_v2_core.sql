ALTER TABLE public.alojamientos
  ADD COLUMN IF NOT EXISTS codigo_integracion TEXT,
  ADD COLUMN IF NOT EXISTS estrellas SMALLINT NOT NULL DEFAULT 3
    CHECK (estrellas BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS score_calificacion NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS total_resenas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS permite_paquete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS descuento_maximo NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5, 2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS tasa_municipal_por_noche NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE public.alojamientos
SET codigo_integracion = 'HTL-' ||
  UPPER(REGEXP_REPLACE(COALESCE(ciudad, 'ALOJAMIENTO'), '[^A-Za-z0-9]+', '-', 'g')) ||
  '-' || UPPER(SUBSTRING(REPLACE(id::TEXT, '-', ''), 1, 8))
WHERE codigo_integracion IS NULL;

ALTER TABLE public.alojamientos
  ALTER COLUMN codigo_integracion SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alojamientos_codigo_integracion_uidx
  ON public.alojamientos (codigo_integracion);

CREATE INDEX IF NOT EXISTS alojamientos_v2_catalog_idx
  ON public.alojamientos (ciudad, estrellas, precio_base_noche);

CREATE OR REPLACE FUNCTION public.set_alojamiento_integracion_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.codigo_integracion IS NULL OR NEW.codigo_integracion = '' THEN
    NEW.codigo_integracion := 'HTL-' ||
      UPPER(REGEXP_REPLACE(COALESCE(NEW.ciudad, 'ALOJAMIENTO'), '[^A-Za-z0-9]+', '-', 'g')) ||
      '-' || UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 8));
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alojamientos_set_integracion_fields
  ON public.alojamientos;
CREATE TRIGGER alojamientos_set_integracion_fields
  BEFORE INSERT OR UPDATE ON public.alojamientos
  FOR EACH ROW EXECUTE FUNCTION public.set_alojamiento_integracion_fields();

CREATE TABLE IF NOT EXISTS public.tipos_habitacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alojamiento_id UUID NOT NULL
    REFERENCES public.alojamientos (id) ON DELETE CASCADE,
  codigo TEXT NOT NULL CHECK (codigo ~ '^[A-Z0-9_]{2,40}$'),
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 2 AND 100),
  capacidad_maxima INTEGER NOT NULL CHECK (capacidad_maxima > 0),
  habitaciones_totales INTEGER NOT NULL CHECK (habitaciones_totales >= 0),
  precio_base_noche NUMERIC(12, 2) NOT NULL CHECK (precio_base_noche >= 0),
  moneda VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (moneda = 'USD'),
  plan_tarifa_codigo TEXT NOT NULL DEFAULT 'FLEX_BB',
  regimen TEXT NOT NULL DEFAULT 'SOLO_HABITACION',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tipos_habitacion_alojamiento_codigo_key
    UNIQUE (alojamiento_id, codigo)
);

INSERT INTO public.tipos_habitacion (
  alojamiento_id, codigo, nombre, capacidad_maxima,
  habitaciones_totales, precio_base_noche
)
SELECT id, 'HABITACION_ESTANDAR', 'Habitación estándar',
       capacidad_maxima, habitaciones_disponibles, precio_base_noche
FROM public.alojamientos
ON CONFLICT (alojamiento_id, codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inventario_diario (
  tipo_habitacion_id UUID NOT NULL
    REFERENCES public.tipos_habitacion (id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  habitaciones_totales INTEGER CHECK (habitaciones_totales >= 0),
  habitaciones_bloqueadas INTEGER NOT NULL DEFAULT 0
    CHECK (habitaciones_bloqueadas >= 0),
  precio_noche NUMERIC(12, 2) CHECK (precio_noche >= 0),
  venta_cerrada BOOLEAN NOT NULL DEFAULT false,
  cerrado_a_llegada BOOLEAN NOT NULL DEFAULT false,
  cerrado_a_salida BOOLEAN NOT NULL DEFAULT false,
  estancia_minima INTEGER CHECK (estancia_minima IS NULL OR estancia_minima > 0),
  estancia_maxima INTEGER CHECK (estancia_maxima IS NULL OR estancia_maxima > 0),
  anticipacion_minima_horas INTEGER NOT NULL DEFAULT 0
    CHECK (anticipacion_minima_horas >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tipo_habitacion_id, fecha)
);

CREATE TABLE IF NOT EXISTS public.cotizaciones_alojamiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alojamiento_id UUID NOT NULL
    REFERENCES public.alojamientos (id) ON DELETE CASCADE,
  tipo_habitacion_id UUID NOT NULL
    REFERENCES public.tipos_habitacion (id) ON DELETE RESTRICT,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  cantidad_habitaciones INTEGER NOT NULL CHECK (cantidad_habitaciones BETWEEN 1 AND 10),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  total_pagar NUMERIC(12, 2) NOT NULL CHECK (total_pagar >= 0),
  desglose JSONB NOT NULL,
  valido_hasta TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (fecha_fin > fecha_inicio)
);

ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS tipo_habitacion_id UUID
    REFERENCES public.tipos_habitacion (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cantidad_habitaciones INTEGER NOT NULL DEFAULT 1
    CHECK (cantidad_habitaciones BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS estado_integracion TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK (estado_integracion IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT')),
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS codigo_reserva TEXT,
  ADD COLUMN IF NOT EXISTS saga_id TEXT,
  ADD COLUMN IF NOT EXISTS cotizacion_id UUID
    REFERENCES public.cotizaciones_alojamiento (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS customer_contact JSONB,
  ADD COLUMN IF NOT EXISTS ocupantes JSONB,
  ADD COLUMN IF NOT EXISTS huespedes_adicionales JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS peticiones_especiales TEXT,
  ADD COLUMN IF NOT EXISTS paquete_aplicado JSONB,
  ADD COLUMN IF NOT EXISTS regimen_hospedaje TEXT,
  ADD COLUMN IF NOT EXISTS plan_tarifa_codigo TEXT,
  ADD COLUMN IF NOT EXISTS modelo_pago TEXT NOT NULL DEFAULT 'PREPAGO',
  ADD COLUMN IF NOT EXISTS desglose_fiscal JSONB,
  ADD COLUMN IF NOT EXISTS codigo_reembolso TEXT;

UPDATE public.reservas AS r
SET tipo_habitacion_id = h.id,
    estado_integracion = CASE
      WHEN r.estado = 'cancelada' THEN 'CANCELLED'
      WHEN r.estado = 'pendiente' THEN 'PENDING'
      ELSE 'CONFIRMED'
    END
FROM public.tipos_habitacion AS h
WHERE h.alojamiento_id = r.alojamiento_id
  AND h.codigo = 'HABITACION_ESTANDAR'
  AND r.tipo_habitacion_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservas_external_order_id_uidx
  ON public.reservas (external_order_id)
  WHERE external_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reservas_codigo_reserva_uidx
  ON public.reservas (codigo_reserva)
  WHERE codigo_reserva IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservas_inventory_dates_idx
  ON public.reservas (tipo_habitacion_id, fecha_checkin, fecha_checkout)
  WHERE estado_integracion <> 'CANCELLED';

CREATE OR REPLACE FUNCTION public.sync_reserva_integracion_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tipo_habitacion_id IS NULL THEN
    SELECT id INTO NEW.tipo_habitacion_id
    FROM public.tipos_habitacion
    WHERE alojamiento_id = NEW.alojamiento_id
      AND codigo = 'HABITACION_ESTANDAR'
    LIMIT 1;
  END IF;
  IF NEW.estado = 'cancelada' THEN
    NEW.estado_integracion := 'CANCELLED';
  ELSIF NEW.estado = 'pendiente' THEN
    NEW.estado_integracion := 'PENDING';
  ELSIF NEW.estado = 'confirmada' AND NEW.estado_integracion NOT IN ('CHECKED_IN', 'CHECKED_OUT') THEN
    NEW.estado_integracion := 'CONFIRMED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservas_sync_integracion_fields ON public.reservas;
CREATE TRIGGER reservas_sync_integracion_fields
  BEFORE INSERT OR UPDATE OF estado, tipo_habitacion_id
  ON public.reservas
  FOR EACH ROW EXECUTE FUNCTION public.sync_reserva_integracion_fields();

CREATE TABLE IF NOT EXISTS public.integracion_idempotencia (
  idempotency_key UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE_ORDER', 'CANCEL_ORDER')),
  request_hash TEXT NOT NULL,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours',
  PRIMARY KEY (idempotency_key, operation)
);

CREATE TABLE IF NOT EXISTS public.integracion_event_counter (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  last_sequence BIGINT NOT NULL DEFAULT 0
);
INSERT INTO public.integracion_event_counter (id, last_sequence)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.integracion_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGINT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN (
    'alojamiento.reserva.confirmada',
    'alojamiento.reserva.cancelada',
    'alojamiento.stock.actualizado'
  )),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subject TEXT NOT NULL,
  correlation_id TEXT,
  data JSONB NOT NULL,
  delivered_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS integracion_outbox_sequence_idx
  ON public.integracion_outbox (sequence);

CREATE OR REPLACE FUNCTION public.append_alojamiento_outbox_event(
  p_type TEXT,
  p_subject TEXT,
  p_correlation_id TEXT,
  p_data JSONB
)
RETURNS public.integracion_outbox
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sequence BIGINT;
  v_event public.integracion_outbox;
BEGIN
  UPDATE public.integracion_event_counter
  SET last_sequence = last_sequence + 1
  WHERE id = 1
  RETURNING last_sequence INTO v_sequence;

  INSERT INTO public.integracion_outbox (
    sequence, type, subject, correlation_id, data
  )
  VALUES (v_sequence, p_type, p_subject, p_correlation_id, p_data)
  RETURNING * INTO v_event;

  UPDATE public.integracion_outbox
  SET data = jsonb_set(data, '{event_id}', to_jsonb(v_event.id::TEXT), true)
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_alojamiento_stock_outbox(
  p_limit INTEGER DEFAULT 10
)
RETURNS SETOF public.integracion_outbox
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.integracion_outbox
    WHERE type = 'alojamiento.stock.actualizado'
      AND delivered_at IS NULL
      AND (locked_until IS NULL OR locked_until <= now())
    ORDER BY sequence
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100)
  )
  UPDATE public.integracion_outbox AS events
  SET attempts = events.attempts + 1,
      locked_until = now() + INTERVAL '60 seconds'
  WHERE events.id IN (SELECT id FROM candidates)
  RETURNING events.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_alojamiento_stock_outbox(
  p_outbox_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.integracion_outbox
  SET delivered_at = CASE WHEN p_success THEN now() ELSE NULL END,
      locked_until = CASE
        WHEN p_success THEN NULL
        ELSE now() + make_interval(
          secs => LEAST(POWER(2, attempts), 300)::INTEGER
        )
      END,
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE LEFT(COALESCE(p_error, 'Stock delivery failed.'), 500)
      END
  WHERE id = p_outbox_id
    AND type = 'alojamiento.stock.actualizado'
    AND delivered_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.alojamientos_v2_disponibilidad(
  p_tipo_habitacion_id UUID,
  p_fecha_inicio DATE,
  p_fecha_fin DATE
)
RETURNS TABLE (habitaciones_remanentes INTEGER, habitaciones_totales INTEGER)
LANGUAGE SQL
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.inventario_diario AS closed
        WHERE closed.tipo_habitacion_id = t.id
          AND closed.fecha >= p_fecha_inicio
          AND closed.fecha < p_fecha_fin
          AND closed.venta_cerrada = true
      ) THEN 0
      ELSE COALESCE(MIN(GREATEST(
        COALESCE(i.habitaciones_totales, t.habitaciones_totales)
        - COALESCE(i.habitaciones_bloqueadas, 0)
        - COALESCE(r.reservadas, 0),
        0
      )), 0)::INTEGER
    END,
    t.habitaciones_totales
  FROM public.tipos_habitacion AS t
  CROSS JOIN GENERATE_SERIES(p_fecha_inicio, p_fecha_fin - 1, INTERVAL '1 day') AS d(fecha)
  LEFT JOIN public.inventario_diario AS i
    ON i.tipo_habitacion_id = t.id AND i.fecha = d.fecha::DATE
  LEFT JOIN LATERAL (
    SELECT SUM(r.cantidad_habitaciones)::INTEGER AS reservadas
    FROM public.reservas AS r
    WHERE r.tipo_habitacion_id = t.id
      AND r.estado_integracion <> 'CANCELLED'
      AND r.fecha_checkin <= d.fecha::DATE
      AND r.fecha_checkout > d.fecha::DATE
  ) AS r ON true
  WHERE t.id = p_tipo_habitacion_id
  GROUP BY t.id, t.habitaciones_totales
$$;

CREATE OR REPLACE FUNCTION public.alojamientos_v2_validar_restricciones(
  p_tipo_habitacion_id UUID,
  p_fecha_inicio DATE,
  p_fecha_fin DATE
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_minima INTEGER;
  v_maxima INTEGER;
  v_anticipacion INTEGER;
  v_noches INTEGER := p_fecha_fin - p_fecha_inicio;
BEGIN
  IF p_fecha_fin <= p_fecha_inicio OR v_noches > 30 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: fechas fuera del rango permitido'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tipos_habitacion
    WHERE id = p_tipo_habitacion_id AND activo = true
  ) THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventario_diario AS i
    WHERE i.tipo_habitacion_id = p_tipo_habitacion_id
      AND i.fecha >= p_fecha_inicio
      AND i.fecha < p_fecha_fin
      AND i.venta_cerrada = true
  ) THEN
    RAISE EXCEPTION 'RESTRICTION_VIOLATED: STOP_SELL'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventario_diario
    WHERE tipo_habitacion_id = p_tipo_habitacion_id
      AND fecha = p_fecha_inicio AND cerrado_a_llegada = true
  ) THEN
    RAISE EXCEPTION 'RESTRICTION_VIOLATED: CLOSED_TO_ARRIVAL'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventario_diario
    WHERE tipo_habitacion_id = p_tipo_habitacion_id
      AND fecha = p_fecha_fin AND cerrado_a_salida = true
  ) THEN
    RAISE EXCEPTION 'RESTRICTION_VIOLATED: CLOSED_TO_DEPARTURE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT estancia_minima, estancia_maxima, anticipacion_minima_horas
  INTO v_minima, v_maxima, v_anticipacion
  FROM public.inventario_diario
  WHERE tipo_habitacion_id = p_tipo_habitacion_id
    AND fecha = p_fecha_inicio;

  IF v_minima IS NOT NULL AND v_noches < v_minima THEN
    RAISE EXCEPTION 'RESTRICTION_VIOLATED: MINIMUM_STAY'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_maxima IS NOT NULL AND v_noches > v_maxima THEN
    RAISE EXCEPTION 'RESTRICTION_VIOLATED: MAXIMUM_STAY'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_anticipacion, 0) > 0 AND
     timezone('America/Guayaquil', now()) >
       (p_fecha_inicio + TIME '14:00') -
         make_interval(hours => v_anticipacion)
  THEN
    RAISE EXCEPTION 'RESTRICTION_VIOLATED: CUTOFF'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_alojamiento_stock_update(
  p_tipo_habitacion_id UUID,
  p_fecha DATE,
  p_delta INTEGER,
  p_reason TEXT,
  p_correlation_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alojamiento_id TEXT;
  v_tipo_habitacion_codigo TEXT;
  v_available INTEGER;
BEGIN
  SELECT a.codigo_integracion, t.codigo
  INTO v_alojamiento_id, v_tipo_habitacion_codigo
  FROM public.tipos_habitacion AS t
  JOIN public.alojamientos AS a ON a.id = t.alojamiento_id
  WHERE t.id = p_tipo_habitacion_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT d.habitaciones_remanentes INTO v_available
  FROM public.alojamientos_v2_disponibilidad(
    p_tipo_habitacion_id, p_fecha, p_fecha + 1
  ) AS d;

  PERFORM public.append_alojamiento_outbox_event(
    'alojamiento.stock.actualizado',
    v_alojamiento_id || ':' || v_tipo_habitacion_codigo,
    p_correlation_id,
    jsonb_build_object(
      'alojamientoId', v_alojamiento_id,
      'tipoHabitacionCodigo', v_tipo_habitacion_codigo,
      'fecha', p_fecha,
      'unidadesDisponibles', COALESCE(v_available, 0),
      'delta', p_delta,
      'reason', p_reason
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_reserva_stock_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date DATE;
  v_old_active BOOLEAN := false;
  v_new_active BOOLEAN := false;
  v_correlation_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_active := OLD.estado_integracion <> 'CANCELLED';
    IF v_old_active THEN
      FOR v_date IN
        SELECT generate_series(
          OLD.fecha_checkin, OLD.fecha_checkout - 1, INTERVAL '1 day'
        )::DATE
      LOOP
        PERFORM public.append_alojamiento_stock_update(
          OLD.tipo_habitacion_id,
          v_date,
          OLD.cantidad_habitaciones,
          'ORDER_UPDATED',
          'reservation:' || OLD.id::TEXT
        );
      END LOOP;
    END IF;
  END IF;

  v_new_active := NEW.estado_integracion <> 'CANCELLED';
  IF v_new_active THEN
    FOR v_date IN
      SELECT generate_series(
        NEW.fecha_checkin, NEW.fecha_checkout - 1, INTERVAL '1 day'
      )::DATE
    LOOP
      PERFORM public.append_alojamiento_stock_update(
        NEW.tipo_habitacion_id,
        v_date,
        -NEW.cantidad_habitaciones,
        CASE WHEN TG_OP = 'INSERT' THEN 'ORDER_CREATED' ELSE 'ORDER_UPDATED' END,
        'reservation:' || NEW.id::TEXT
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservas_sync_stock_outbox ON public.reservas;
CREATE TRIGGER reservas_sync_stock_outbox
  AFTER INSERT OR UPDATE OF
    tipo_habitacion_id, fecha_checkin, fecha_checkout,
    cantidad_habitaciones, estado_integracion
  ON public.reservas
  FOR EACH ROW EXECUTE FUNCTION public.sync_reserva_stock_outbox();

CREATE OR REPLACE FUNCTION public.sync_inventario_stock_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id UUID;
  v_room_total INTEGER;
  v_reserved INTEGER;
  v_old_available INTEGER;
  v_new_available INTEGER;
  v_delta INTEGER;
  v_closed BOOLEAN := false;
  v_reason TEXT;
BEGIN
  v_room_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.tipo_habitacion_id ELSE NEW.tipo_habitacion_id END;
  SELECT habitaciones_totales INTO v_room_total
  FROM public.tipos_habitacion WHERE id = v_room_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(cantidad_habitaciones), 0)::INTEGER
  INTO v_reserved
  FROM public.reservas
  WHERE tipo_habitacion_id = v_room_id
    AND estado_integracion <> 'CANCELLED'
    AND fecha_checkin <= CASE WHEN TG_OP = 'DELETE' THEN OLD.fecha ELSE NEW.fecha END
    AND fecha_checkout > CASE WHEN TG_OP = 'DELETE' THEN OLD.fecha ELSE NEW.fecha END;

  IF TG_OP <> 'INSERT' THEN
    SELECT GREATEST(
      COALESCE(OLD.habitaciones_totales, v_room_total)
        - OLD.habitaciones_bloqueadas - v_reserved,
      0
    ) INTO v_old_available;
    IF OLD.venta_cerrada THEN v_old_available := 0; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT GREATEST(
      COALESCE(NEW.habitaciones_totales, v_room_total)
        - NEW.habitaciones_bloqueadas - v_reserved,
      0
    ) INTO v_new_available;
    v_closed := NEW.venta_cerrada;
    IF v_closed THEN v_new_available := 0; END IF;
  ELSE
    v_new_available := GREATEST(v_room_total - v_reserved, 0);
  END IF;

  v_delta := COALESCE(v_new_available, 0) - COALESCE(v_old_available, 0);
  v_reason := CASE
    WHEN TG_OP = 'INSERT' THEN 'INVENTORY_LOADED'
    WHEN TG_OP = 'DELETE' THEN 'INVENTORY_REMOVED'
    WHEN OLD.habitaciones_bloqueadas <> NEW.habitaciones_bloqueadas
      THEN 'ROOM_BLOCKED'
    ELSE 'INVENTORY_UPDATED'
  END;
  PERFORM public.append_alojamiento_stock_update(
    v_room_id,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.fecha ELSE NEW.fecha END,
    v_delta,
    v_reason,
    'inventory:' || v_room_id::TEXT
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventario_diario_sync_stock_outbox
  ON public.inventario_diario;
CREATE TRIGGER inventario_diario_sync_stock_outbox
  AFTER INSERT OR UPDATE OR DELETE ON public.inventario_diario
  FOR EACH ROW EXECUTE FUNCTION public.sync_inventario_stock_outbox();

CREATE SEQUENCE IF NOT EXISTS public.alojamientos_refund_code_seq
  START WITH 10000 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.create_alojamiento_order_v2(
  p_idempotency_key UUID,
  p_request_hash TEXT,
  p_order JSONB,
  p_correlation_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_idempotency public.integracion_idempotencia;
  v_reservation public.reservas;
  v_room public.tipos_habitacion;
  v_date DATE;
  v_available INTEGER;
  v_amount INTEGER := (p_order->>'cantidadHabitaciones')::INTEGER;
  v_quote public.cotizaciones_alojamiento;
  v_iva NUMERIC(5, 2);
  v_tax_per_night NUMERIC(12, 2);
  v_subtotal NUMERIC(12, 2);
  v_expected_total NUMERIC(12, 2);
  v_discount NUMERIC(12, 2) :=
    COALESCE((p_order->'desgloseFiscal'->>'descuentoCombo')::NUMERIC, 0);
  v_package_percent NUMERIC(5, 2);
  v_max_discount NUMERIC(5, 2);
  v_allows_package BOOLEAN;
  v_result JSONB;
BEGIN
  INSERT INTO public.integracion_idempotencia (
    idempotency_key, operation, request_hash
  )
  VALUES (p_idempotency_key, 'CREATE_ORDER', p_request_hash)
  ON CONFLICT (idempotency_key, operation) DO NOTHING;

  SELECT * INTO v_idempotency
  FROM public.integracion_idempotencia
  WHERE idempotency_key = p_idempotency_key
    AND operation = 'CREATE_ORDER'
  FOR UPDATE;

  IF v_idempotency.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
  END IF;
  IF v_idempotency.response_body IS NOT NULL THEN
    RETURN v_idempotency.response_body ||
      jsonb_build_object('_idempotent_replayed', true);
  END IF;

  SELECT * INTO v_room
  FROM public.tipos_habitacion
  WHERE id = (p_order->>'tipo_habitacion_id')::UUID
    AND activo = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF ((p_order->'ocupantes'->>'adultos')::INTEGER +
      COALESCE((p_order->'ocupantes'->>'ninos')::INTEGER, 0)) >
     v_room.capacidad_maxima * v_amount
  THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED' USING ERRCODE = 'P0001';
  END IF;
  IF p_order->>'regimen' IS DISTINCT FROM v_room.regimen THEN
    RAISE EXCEPTION 'RESTRICTION_VIOLATED: REGIMEN'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT permite_paquete, descuento_maximo
  INTO v_allows_package, v_max_discount
  FROM public.alojamientos
  WHERE id = v_room.alojamiento_id;
  IF p_order->'paquete' IS NOT NULL AND
     p_order->'paquete' <> 'null'::JSONB THEN
    IF NOT COALESCE(v_allows_package, false) THEN
      RAISE EXCEPTION 'PROMOTIONS_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
    v_package_percent :=
      (p_order->'paquete'->>'descuentoPorcentaje')::NUMERIC;
    IF v_package_percent > COALESCE(v_max_discount, 0) THEN
      RAISE EXCEPTION 'DISCOUNT_EXCEEDS_CONTRACT' USING ERRCODE = 'P0001';
    END IF;
    IF round(
      (p_order->'desgloseFiscal'->>'subtotal')::NUMERIC *
        v_package_percent / 100,
      2
    ) <> v_discount OR
       round((p_order->'paquete'->>'descuentoMonto')::NUMERIC, 2) <> v_discount
    THEN
      RAISE EXCEPTION 'VALIDATION_FAILED: package discount mismatch'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_discount <> 0 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: unexpected discount'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.alojamientos_v2_validar_restricciones(
    v_room.id,
    (p_order->>'fechaInicio')::DATE,
    (p_order->>'fechaFin')::DATE
  );

  IF NULLIF(p_order->>'cotizacionId', '') IS NOT NULL THEN
    SELECT * INTO v_quote
    FROM public.cotizaciones_alojamiento
    WHERE id = (p_order->>'cotizacionId')::UUID
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QUOTE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_quote.valido_hasta <= now() THEN
      RAISE EXCEPTION 'QUOTE_EXPIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_quote.alojamiento_id <> v_room.alojamiento_id OR
       v_quote.tipo_habitacion_id <> v_room.id OR
       v_quote.fecha_inicio <> (p_order->>'fechaInicio')::DATE OR
       v_quote.fecha_fin <> (p_order->>'fechaFin')::DATE OR
       v_quote.cantidad_habitaciones <> v_amount OR
       round(v_quote.total_pagar, 2) <>
         round((p_order->'desgloseFiscal'->>'total')::NUMERIC + v_discount, 2)
    THEN
      RAISE EXCEPTION 'PRICE_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    PERFORM 1
    FROM public.inventario_diario
    WHERE tipo_habitacion_id = v_room.id
      AND fecha >= (p_order->>'fechaInicio')::DATE
      AND fecha < (p_order->>'fechaFin')::DATE
    FOR SHARE;

    SELECT COALESCE(a.iva_porcentaje, 15),
           COALESCE(a.tasa_municipal_por_noche, 0)
    INTO v_iva, v_tax_per_night
    FROM public.alojamientos AS a
    WHERE a.id = v_room.alojamiento_id;

    SELECT COALESCE(SUM(COALESCE(i.precio_noche, v_room.precio_base_noche)), 0)
      * v_amount
    INTO v_subtotal
    FROM GENERATE_SERIES(
      (p_order->>'fechaInicio')::DATE,
      (p_order->>'fechaFin')::DATE - 1,
      INTERVAL '1 day'
    ) AS d(fecha)
    LEFT JOIN public.inventario_diario AS i
      ON i.tipo_habitacion_id = v_room.id AND i.fecha = d.fecha::DATE;

    v_expected_total := v_subtotal +
      round(v_subtotal * v_iva / 100, 2) +
      (v_tax_per_night * v_amount *
        ((p_order->>'fechaFin')::DATE - (p_order->>'fechaInicio')::DATE));
    IF round(v_expected_total, 2) <>
       round((p_order->'desgloseFiscal'->>'total')::NUMERIC + v_discount, 2)
    THEN
      RAISE EXCEPTION 'PRICE_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR v_date IN
    SELECT generate_series(
      (p_order->>'fechaInicio')::DATE,
      (p_order->>'fechaFin')::DATE - 1,
      INTERVAL '1 day'
    )::DATE
  LOOP
    SELECT d.habitaciones_remanentes INTO v_available
    FROM public.alojamientos_v2_disponibilidad(
      v_room.id, v_date, v_date + 1
    ) AS d;
    IF COALESCE(v_available, 0) < v_amount THEN
      RAISE EXCEPTION 'OUT_OF_STOCK' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO public.reservas (
    alojamiento_id, tipo_habitacion_id,
    cliente_nombre, cliente_email, cliente_telefono,
    fecha_checkin, fecha_checkout, num_huespedes,
    cantidad_habitaciones, precio_total, moneda,
    metodo_pago_simulado, pago_estado, estado, estado_integracion,
    external_order_id, codigo_reserva, saga_id, cotizacion_id,
    payment_method, payment_reference, customer_contact,
    ocupantes, huespedes_adicionales, peticiones_especiales,
    paquete_aplicado, regimen_hospedaje, plan_tarifa_codigo,
    modelo_pago, desglose_fiscal
  )
  VALUES (
    (p_order->>'alojamiento_db_id')::UUID,
    v_room.id,
    p_order->'huespedTitular'->>'nombreCompleto',
    p_order->'huespedTitular'->>'email',
    p_order->'huespedTitular'->>'telefono',
    (p_order->>'fechaInicio')::DATE,
    (p_order->>'fechaFin')::DATE,
    ((p_order->'ocupantes'->>'adultos')::INTEGER +
      COALESCE((p_order->'ocupantes'->>'ninos')::INTEGER, 0)),
    v_amount,
    (p_order->>'totalPagar')::NUMERIC,
    'USD',
    COALESCE(p_order->>'payment_method', 'PAGO_EN_SITIO'),
    'pendiente',
    'confirmada',
    'CONFIRMED',
    p_order->>'external_order_id',
    p_order->>'codigoReserva',
    p_order->>'saga_id',
    NULLIF(p_order->>'cotizacionId', '')::UUID,
    p_order->>'payment_method',
    p_order->>'payment_reference',
    p_order->'huespedTitular',
    p_order->'ocupantes',
    COALESCE(p_order->'huespedesAdicionales', '[]'::JSONB),
    p_order->>'peticionesEspeciales',
    p_order->'paquete',
    p_order->>'regimen',
    p_order->>'planTarifaCodigo',
    COALESCE(p_order->>'modeloPago', 'PREPAGO'),
    p_order->'desgloseFiscal'
  )
  RETURNING * INTO v_reservation;

  PERFORM public.append_alojamiento_outbox_event(
    'alojamiento.reserva.confirmada',
    v_reservation.external_order_id,
    p_correlation_id,
    jsonb_build_object(
      'orderId', v_reservation.id,
      'external_order_id', v_reservation.external_order_id,
      'saga_id', v_reservation.saga_id,
      'estado', 'CONFIRMED',
      'alojamientoId', p_order->>'alojamientoId',
      'total', p_order->>'totalPagar'
    )
  );

  v_result := (p_order->'response') || jsonb_build_object(
    'orderId', v_reservation.id,
    'estado', 'CONFIRMED',
    'createdAt', v_reservation.created_at
  );
  UPDATE public.integracion_idempotencia
  SET response_body = v_result
  WHERE idempotency_key = p_idempotency_key
    AND operation = 'CREATE_ORDER';

  RETURN v_result || jsonb_build_object('_idempotent_replayed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_alojamiento_order_v2(
  p_idempotency_key UUID,
  p_request_hash TEXT,
  p_order_ref TEXT,
  p_requested_by TEXT,
  p_correlation_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_idempotency public.integracion_idempotencia;
  v_reservation public.reservas;
  v_refund_percent NUMERIC(5, 2);
  v_refund NUMERIC(12, 2);
  v_penalty NUMERIC(12, 2);
  v_result JSONB;
BEGIN
  INSERT INTO public.integracion_idempotencia (
    idempotency_key, operation, request_hash
  )
  VALUES (p_idempotency_key, 'CANCEL_ORDER', p_request_hash)
  ON CONFLICT (idempotency_key, operation) DO NOTHING;

  SELECT * INTO v_idempotency
  FROM public.integracion_idempotencia
  WHERE idempotency_key = p_idempotency_key
    AND operation = 'CANCEL_ORDER'
  FOR UPDATE;

  IF v_idempotency.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
  END IF;
  IF v_idempotency.response_body IS NOT NULL THEN
    RETURN v_idempotency.response_body ||
      jsonb_build_object('_idempotent_replayed', true);
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservas
  WHERE id::TEXT = p_order_ref
     OR external_order_id = p_order_ref
     OR codigo_reserva = p_order_ref
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_reservation.estado_integracion IN ('CHECKED_IN', 'CHECKED_OUT') THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF v_reservation.estado_integracion = 'CANCELLED' THEN
    v_refund_percent := 0;
    v_refund := 0;
    v_penalty := v_reservation.precio_total;
    v_result := jsonb_build_object(
      'orderId', v_reservation.id,
      'external_order_id', v_reservation.external_order_id,
      'estado', 'CANCELLED',
      'refundStatus', 'NO_REFUND',
      'codigoReembolso', v_reservation.codigo_reembolso,
      'porcentajeReembolso', 0,
      'montoReembolsado', '0.00',
      'penalidad', to_char(v_penalty, 'FM9999999990.00'),
      'cuposRestaurados', true,
      'yaCancelada', true,
      'timestamp', now()
    );
  ELSE
    IF p_requested_by = 'SAGA_ORCHESTRATOR' OR
       timezone('America/Guayaquil', now()) <=
         (v_reservation.fecha_checkin + TIME '14:00') - INTERVAL '48 hours'
    THEN
      v_refund_percent := 100;
    ELSE
      v_refund_percent := 0;
    END IF;
    v_refund := round(v_reservation.precio_total * v_refund_percent / 100, 2);
    v_penalty := v_reservation.precio_total - v_refund;

    UPDATE public.reservas
    SET estado = 'cancelada',
        estado_integracion = 'CANCELLED',
        codigo_reembolso = COALESCE(
          codigo_reembolso,
          'REF-HTL-' || nextval('public.alojamientos_refund_code_seq')::TEXT
        )
    WHERE id = v_reservation.id
    RETURNING * INTO v_reservation;

    v_result := jsonb_build_object(
      'orderId', v_reservation.id,
      'external_order_id', v_reservation.external_order_id,
      'estado', 'CANCELLED',
      'refundStatus', CASE
        WHEN v_refund_percent = 0 THEN 'NO_REFUND'
        ELSE 'COMPENSATED'
      END,
      'codigoReembolso', v_reservation.codigo_reembolso,
      'porcentajeReembolso', v_refund_percent,
      'montoReembolsado', to_char(v_refund, 'FM9999999990.00'),
      'penalidad', to_char(v_penalty, 'FM9999999990.00'),
      'cuposRestaurados', true,
      'yaCancelada', false,
      'timestamp', now()
    );

    PERFORM public.append_alojamiento_outbox_event(
      'alojamiento.reserva.cancelada',
      v_reservation.external_order_id,
      p_correlation_id,
      jsonb_build_object(
        'orderId', v_reservation.id,
        'external_order_id', v_reservation.external_order_id,
        'saga_id', v_reservation.saga_id,
        'estado', 'CANCELLED',
        'alojamientoId', (
          SELECT codigo_integracion FROM public.alojamientos
          WHERE id = v_reservation.alojamiento_id
        ),
        'total', to_char(v_reservation.precio_total, 'FM9999999990.00')
      )
    );

  END IF;

  UPDATE public.integracion_idempotencia
  SET response_body = v_result
  WHERE idempotency_key = p_idempotency_key
    AND operation = 'CANCEL_ORDER';

  RETURN v_result || jsonb_build_object('_idempotent_replayed', false);
END;
$$;

ALTER TABLE public.tipos_habitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_diario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizaciones_alojamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracion_idempotencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracion_event_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracion_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tipos_habitacion,
  public.inventario_diario,
  public.cotizaciones_alojamiento,
  public.integracion_idempotencia,
  public.integracion_event_counter,
  public.integracion_outbox
FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.append_alojamiento_outbox_event(
  TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_alojamiento_stock_update(
  UUID, DATE, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_alojamiento_stock_outbox(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_alojamiento_stock_outbox(
  UUID, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alojamientos_v2_disponibilidad(
  UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alojamientos_v2_validar_restricciones(
  UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_alojamiento_order_v2(
  UUID, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_alojamiento_order_v2(
  UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_alojamiento_outbox_event(
  TEXT, TEXT, TEXT, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_alojamiento_stock_update(
  UUID, DATE, INTEGER, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_alojamiento_stock_outbox(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_alojamiento_stock_outbox(
  UUID, BOOLEAN, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.alojamientos_v2_disponibilidad(
  UUID, DATE, DATE
) TO service_role;
GRANT EXECUTE ON FUNCTION public.alojamientos_v2_validar_restricciones(
  UUID, DATE, DATE
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_alojamiento_order_v2(
  UUID, TEXT, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_alojamiento_order_v2(
  UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
