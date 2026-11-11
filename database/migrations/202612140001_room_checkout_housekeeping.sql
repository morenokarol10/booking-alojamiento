ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkout_consumos JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS checkout_consumos_total NUMERIC(12, 2)
    NOT NULL DEFAULT 0 CHECK (checkout_consumos_total >= 0),
  ADD COLUMN IF NOT EXISTS checkout_metodo_pago TEXT;

CREATE TABLE IF NOT EXISTS public.unidades_habitacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_habitacion_id UUID NOT NULL
    REFERENCES public.tipos_habitacion (id) ON DELETE CASCADE,
  numero INTEGER NOT NULL CHECK (numero > 0),
  codigo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'DISPONIBLE'
    CHECK (estado IN ('DISPONIBLE', 'RESERVADA', 'OCUPADA', 'LIMPIEZA')),
  limpieza_inicio TIMESTAMPTZ,
  limpieza_hasta TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tipo_habitacion_id, numero),
  UNIQUE (tipo_habitacion_id, codigo),
  CHECK (
    (estado = 'LIMPIEZA' AND limpieza_inicio IS NOT NULL AND limpieza_hasta IS NOT NULL)
    OR
    (estado <> 'LIMPIEZA' AND limpieza_inicio IS NULL AND limpieza_hasta IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.reservas_unidades_habitacion (
  reserva_id UUID NOT NULL
    REFERENCES public.reservas (id) ON DELETE CASCADE,
  unidad_id UUID NOT NULL
    REFERENCES public.unidades_habitacion (id) ON DELETE RESTRICT,
  asignada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reserva_id, unidad_id)
);

CREATE INDEX IF NOT EXISTS reservas_unidades_habitacion_unidad_idx
  ON public.reservas_unidades_habitacion (unidad_id, reserva_id);

INSERT INTO public.unidades_habitacion (
  tipo_habitacion_id, numero, codigo
)
SELECT
  t.id,
  room_number.numero,
  t.codigo || '-' || LPAD(room_number.numero::TEXT, 3, '0')
FROM public.tipos_habitacion AS t
CROSS JOIN LATERAL GENERATE_SERIES(1, t.habitaciones_totales)
  AS room_number(numero)
ON CONFLICT (tipo_habitacion_id, numero) DO NOTHING;

DO $$
DECLARE
  v_reservation RECORD;
  v_room_id UUID;
  v_room_number INTEGER;
BEGIN
  FOR v_reservation IN
    SELECT
      id,
      tipo_habitacion_id,
      fecha_checkin,
      fecha_checkout,
      cantidad_habitaciones,
      estado_integracion
    FROM public.reservas
    WHERE tipo_habitacion_id IS NOT NULL
      AND (
        estado_integracion = 'CHECKED_IN'
        OR (
          estado_integracion = 'CONFIRMED'
          AND fecha_checkout > timezone('America/Guayaquil', now())::DATE
        )
      )
    ORDER BY fecha_checkin, id
  LOOP
    FOR v_room_number IN 1..v_reservation.cantidad_habitaciones LOOP
      SELECT unit.id INTO v_room_id
      FROM public.unidades_habitacion AS unit
      JOIN public.tipos_habitacion AS room_type
        ON room_type.id = unit.tipo_habitacion_id
      WHERE unit.tipo_habitacion_id = v_reservation.tipo_habitacion_id
        AND unit.numero <= room_type.habitaciones_totales
        AND NOT EXISTS (
          SELECT 1
          FROM public.reservas_unidades_habitacion AS assignment
          JOIN public.reservas AS assigned_reservation
            ON assigned_reservation.id = assignment.reserva_id
          WHERE assignment.unidad_id = unit.id
            AND assigned_reservation.estado_integracion
              NOT IN ('CANCELLED', 'CHECKED_OUT')
            AND assigned_reservation.fecha_checkin < v_reservation.fecha_checkout
            AND assigned_reservation.fecha_checkout > v_reservation.fecha_checkin
        )
      ORDER BY unit.numero
      LIMIT 1
      FOR UPDATE OF unit SKIP LOCKED;

      IF v_room_id IS NULL THEN
        RAISE EXCEPTION
          'ROOM_UNIT_ASSIGNMENT_BACKFILL_FAILED: reservation %',
          v_reservation.id;
      END IF;

      INSERT INTO public.reservas_unidades_habitacion (
        reserva_id, unidad_id
      )
      VALUES (v_reservation.id, v_room_id);

      UPDATE public.unidades_habitacion
      SET estado = CASE
        WHEN v_reservation.estado_integracion = 'CHECKED_IN' THEN 'OCUPADA'
        ELSE 'RESERVADA'
      END
      WHERE id = v_room_id;

      v_room_id := NULL;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_units_for_room_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.unidades_habitacion (
    tipo_habitacion_id, numero, codigo
  )
  SELECT
    NEW.id,
    room_number.numero,
    NEW.codigo || '-' || LPAD(room_number.numero::TEXT, 3, '0')
  FROM GENERATE_SERIES(1, NEW.habitaciones_totales)
    AS room_number(numero)
  ON CONFLICT (tipo_habitacion_id, numero) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tipos_habitacion_sync_units ON public.tipos_habitacion;
CREATE TRIGGER tipos_habitacion_sync_units
  AFTER INSERT OR UPDATE OF habitaciones_totales, codigo
  ON public.tipos_habitacion
  FOR EACH ROW EXECUTE FUNCTION public.sync_units_for_room_type();

CREATE OR REPLACE FUNCTION public.assign_units_to_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit_id UUID;
  v_index INTEGER;
BEGIN
  IF NEW.tipo_habitacion_id IS NULL OR
     NEW.estado_integracion IN ('CANCELLED', 'CHECKED_OUT')
  THEN
    RETURN NEW;
  END IF;

  FOR v_index IN 1..NEW.cantidad_habitaciones LOOP
    SELECT unit.id INTO v_unit_id
    FROM public.unidades_habitacion AS unit
    JOIN public.tipos_habitacion AS room_type
      ON room_type.id = unit.tipo_habitacion_id
    WHERE unit.tipo_habitacion_id = NEW.tipo_habitacion_id
      AND unit.numero <= room_type.habitaciones_totales
      AND (
        unit.estado IN ('DISPONIBLE', 'RESERVADA', 'OCUPADA')
        OR (
          unit.estado = 'LIMPIEZA'
          AND unit.limpieza_hasta <=
            ((NEW.fecha_checkin + TIME '14:00') AT TIME ZONE 'America/Guayaquil')
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reservas_unidades_habitacion AS own_assignment
        WHERE own_assignment.reserva_id = NEW.id
          AND own_assignment.unidad_id = unit.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reservas_unidades_habitacion AS assignment
        JOIN public.reservas AS other_reservation
          ON other_reservation.id = assignment.reserva_id
        WHERE assignment.unidad_id = unit.id
          AND other_reservation.id <> NEW.id
          AND other_reservation.estado_integracion
            NOT IN ('CANCELLED', 'CHECKED_OUT')
          AND other_reservation.fecha_checkin < NEW.fecha_checkout
          AND other_reservation.fecha_checkout > NEW.fecha_checkin
      )
    ORDER BY unit.numero
    LIMIT 1
    FOR UPDATE OF unit SKIP LOCKED;

    IF v_unit_id IS NULL THEN
      RAISE EXCEPTION 'NO_ROOMS_AVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.reservas_unidades_habitacion (
      reserva_id, unidad_id
    )
    VALUES (NEW.id, v_unit_id);

    UPDATE public.unidades_habitacion
    SET estado = CASE
          WHEN NEW.estado_integracion = 'CHECKED_IN' THEN 'OCUPADA'
          WHEN estado = 'LIMPIEZA' AND limpieza_hasta > now() THEN 'LIMPIEZA'
          ELSE 'RESERVADA'
        END,
        limpieza_inicio = CASE
          WHEN estado = 'LIMPIEZA' AND limpieza_hasta > now()
            THEN limpieza_inicio
          ELSE NULL
        END,
        limpieza_hasta = CASE
          WHEN estado = 'LIMPIEZA' AND limpieza_hasta > now()
            THEN limpieza_hasta
          ELSE NULL
        END
    WHERE id = v_unit_id;

    v_unit_id := NULL;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservas_assign_room_units ON public.reservas;
CREATE TRIGGER reservas_assign_room_units
  AFTER INSERT ON public.reservas
  FOR EACH ROW EXECUTE FUNCTION public.assign_units_to_reservation();

CREATE OR REPLACE FUNCTION public.sync_reservation_room_states()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assigned_count INTEGER;
BEGIN
  IF NEW.estado_integracion = 'CHECKED_IN' THEN
    SELECT COUNT(*)::INTEGER INTO v_assigned_count
    FROM public.reservas_unidades_habitacion
    WHERE reserva_id = NEW.id;

    IF v_assigned_count < NEW.cantidad_habitaciones THEN
      RAISE EXCEPTION 'ROOM_ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.reservas_unidades_habitacion AS assignment
      JOIN public.unidades_habitacion AS unit ON unit.id = assignment.unidad_id
      WHERE assignment.reserva_id = NEW.id
        AND unit.estado = 'LIMPIEZA'
        AND unit.limpieza_hasta > now()
    ) THEN
      RAISE EXCEPTION 'ROOM_STILL_CLEANING' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.reservas_unidades_habitacion AS assignment
      JOIN public.unidades_habitacion AS unit ON unit.id = assignment.unidad_id
      JOIN public.reservas_unidades_habitacion AS prior_assignment
        ON prior_assignment.unidad_id = unit.id
       AND prior_assignment.reserva_id <> NEW.id
      JOIN public.reservas AS prior_reservation
        ON prior_reservation.id = prior_assignment.reserva_id
      WHERE assignment.reserva_id = NEW.id
        AND unit.estado = 'OCUPADA'
        AND prior_reservation.estado_integracion = 'CHECKED_IN'
    ) THEN
      RAISE EXCEPTION 'ROOM_STILL_OCCUPIED' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.unidades_habitacion AS unit
    SET estado = 'OCUPADA',
        limpieza_inicio = NULL,
        limpieza_hasta = NULL
    FROM public.reservas_unidades_habitacion AS assignment
    WHERE assignment.reserva_id = NEW.id
      AND assignment.unidad_id = unit.id;
  ELSIF NEW.estado_integracion = 'CHECKED_OUT' THEN
    UPDATE public.unidades_habitacion AS unit
    SET estado = 'LIMPIEZA',
        limpieza_inicio = COALESCE(NEW.checkout_at, now()),
        limpieza_hasta = COALESCE(NEW.checkout_at, now()) + INTERVAL '1 hour'
    FROM public.reservas_unidades_habitacion AS assignment
    WHERE assignment.reserva_id = NEW.id
      AND assignment.unidad_id = unit.id;
  ELSIF NEW.estado_integracion = 'CANCELLED' THEN
    UPDATE public.unidades_habitacion AS unit
    SET estado = CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.reservas_unidades_habitacion AS future_assignment
            JOIN public.reservas AS future_reservation
              ON future_reservation.id = future_assignment.reserva_id
            WHERE future_assignment.unidad_id = unit.id
              AND future_reservation.id <> NEW.id
              AND future_reservation.estado_integracion = 'CONFIRMED'
          ) THEN 'RESERVADA'
          ELSE 'DISPONIBLE'
        END
    FROM public.reservas_unidades_habitacion AS assignment
    WHERE assignment.reserva_id = NEW.id
      AND assignment.unidad_id = unit.id
      AND unit.estado <> 'LIMPIEZA';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservas_sync_room_states ON public.reservas;
CREATE TRIGGER reservas_sync_room_states
  AFTER UPDATE OF estado, estado_integracion ON public.reservas
  FOR EACH ROW
  WHEN (OLD.estado_integracion IS DISTINCT FROM NEW.estado_integracion)
  EXECUTE FUNCTION public.sync_reservation_room_states();

CREATE OR REPLACE FUNCTION public.sync_room_cleaning_stock_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_delta INTEGER;
BEGIN
  IF NEW.estado = 'LIMPIEZA' AND
     (OLD.estado IS DISTINCT FROM NEW.estado OR
      OLD.limpieza_hasta IS DISTINCT FROM NEW.limpieza_hasta)
  THEN
    v_start_date := (NEW.limpieza_inicio AT TIME ZONE 'America/Guayaquil')::DATE;
    v_end_date := (
      (NEW.limpieza_hasta - INTERVAL '1 microsecond')
      AT TIME ZONE 'America/Guayaquil'
    )::DATE;
    FOR v_date IN
      SELECT GENERATE_SERIES(v_start_date, v_end_date, INTERVAL '1 day')::DATE
    LOOP
      v_delta := CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.reservas_unidades_habitacion AS assignment
          JOIN public.reservas AS reservation
            ON reservation.id = assignment.reserva_id
          WHERE assignment.unidad_id = NEW.id
            AND reservation.estado_integracion
              NOT IN ('CANCELLED', 'CHECKED_OUT')
            AND reservation.fecha_checkin <= v_date
            AND reservation.fecha_checkout > v_date
        ) THEN 0
        ELSE -1
      END;
      PERFORM public.append_alojamiento_stock_update(
        NEW.tipo_habitacion_id,
        v_date,
        v_delta,
        'ROOM_CLEANING_STARTED',
        'room-cleaning:' || NEW.id::TEXT
      );
    END LOOP;
  ELSIF OLD.estado = 'LIMPIEZA' AND NEW.estado <> 'LIMPIEZA' THEN
    v_start_date := (OLD.limpieza_inicio AT TIME ZONE 'America/Guayaquil')::DATE;
    v_end_date := (
      (OLD.limpieza_hasta - INTERVAL '1 microsecond')
      AT TIME ZONE 'America/Guayaquil'
    )::DATE;
    FOR v_date IN
      SELECT GENERATE_SERIES(v_start_date, v_end_date, INTERVAL '1 day')::DATE
    LOOP
      v_delta := CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.reservas_unidades_habitacion AS assignment
          JOIN public.reservas AS reservation
            ON reservation.id = assignment.reserva_id
          WHERE assignment.unidad_id = NEW.id
            AND reservation.estado_integracion
              NOT IN ('CANCELLED', 'CHECKED_OUT')
            AND reservation.fecha_checkin <= v_date
            AND reservation.fecha_checkout > v_date
        ) THEN 0
        ELSE 1
      END;
      PERFORM public.append_alojamiento_stock_update(
        NEW.tipo_habitacion_id,
        v_date,
        v_delta,
        'ROOM_CLEANING_COMPLETED',
        'room-cleaning:' || NEW.id::TEXT
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS unidades_habitacion_sync_cleaning_stock
  ON public.unidades_habitacion;
CREATE TRIGGER unidades_habitacion_sync_cleaning_stock
  AFTER UPDATE OF estado, limpieza_hasta ON public.unidades_habitacion
  FOR EACH ROW EXECUTE FUNCTION public.sync_room_cleaning_stock_outbox();

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
        - COALESCE(r.reservadas, 0)
        - COALESCE(cleaning.unidades_en_limpieza, 0),
        0
      )), 0)::INTEGER
    END,
    t.habitaciones_totales
  FROM public.tipos_habitacion AS t
  CROSS JOIN GENERATE_SERIES(
    p_fecha_inicio, p_fecha_fin - 1, INTERVAL '1 day'
  ) AS d(fecha)
  LEFT JOIN public.inventario_diario AS i
    ON i.tipo_habitacion_id = t.id AND i.fecha = d.fecha::DATE
  LEFT JOIN LATERAL (
    SELECT SUM(r.cantidad_habitaciones)::INTEGER AS reservadas
    FROM public.reservas AS r
    WHERE r.tipo_habitacion_id = t.id
      AND r.estado_integracion NOT IN ('CANCELLED', 'CHECKED_OUT')
      AND r.fecha_checkin <= d.fecha::DATE
      AND r.fecha_checkout > d.fecha::DATE
  ) AS r ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS unidades_en_limpieza
    FROM public.unidades_habitacion AS unit
    WHERE unit.tipo_habitacion_id = t.id
      AND unit.numero <= COALESCE(i.habitaciones_totales, t.habitaciones_totales)
      AND unit.estado = 'LIMPIEZA'
      AND unit.limpieza_hasta > now()
      AND unit.limpieza_inicio <
        (((d.fecha::DATE + 1)::TIMESTAMP) AT TIME ZONE 'America/Guayaquil')
      AND unit.limpieza_hasta >
        (((d.fecha::DATE)::TIMESTAMP) AT TIME ZONE 'America/Guayaquil')
      AND NOT EXISTS (
        SELECT 1
        FROM public.reservas_unidades_habitacion AS assignment
        JOIN public.reservas AS reservation
          ON reservation.id = assignment.reserva_id
        WHERE assignment.unidad_id = unit.id
          AND reservation.estado_integracion
            NOT IN ('CANCELLED', 'CHECKED_OUT')
          AND reservation.fecha_checkin <= d.fecha::DATE
          AND reservation.fecha_checkout > d.fecha::DATE
      )
  ) AS cleaning ON true
  WHERE t.id = p_tipo_habitacion_id
  GROUP BY t.id, t.habitaciones_totales
$$;

CREATE OR REPLACE FUNCTION public.checkout_alojamiento_order_v2(
  p_order_ref TEXT,
  p_correlation_id TEXT,
  p_consumos JSONB DEFAULT '[]'::JSONB,
  p_metodo_pago TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.reservas;
  v_consumos_total NUMERIC(12, 2);
  v_assigned_count INTEGER;
  v_room_codes TEXT;
  v_room_state TEXT;
  v_cleaning_until TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  SELECT * INTO v_reservation
  FROM public.reservas
  WHERE id::TEXT = p_order_ref
     OR external_order_id = p_order_ref
     OR codigo_reserva = p_order_ref
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.estado_integracion = 'CHECKED_OUT' THEN
    v_consumos_total := COALESCE(v_reservation.checkout_consumos_total, 0);
  ELSIF v_reservation.estado_integracion <> 'CHECKED_IN' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
  ELSE
    SELECT COUNT(*)::INTEGER INTO v_assigned_count
    FROM public.reservas_unidades_habitacion
    WHERE reserva_id = v_reservation.id;
    IF v_assigned_count < v_reservation.cantidad_habitaciones THEN
      RAISE EXCEPTION 'ROOM_ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(COALESCE(p_consumos, '[]'::JSONB)) <> 'array' THEN
      RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(SUM(
      COALESCE(NULLIF(item->>'cantidad', '')::NUMERIC, 1)
      * (item->>'precio')::NUMERIC
    ), 0)::NUMERIC(12, 2)
    INTO v_consumos_total
    FROM jsonb_array_elements(COALESCE(p_consumos, '[]'::JSONB)) AS items(item);

    UPDATE public.reservas
    SET estado_integracion = 'CHECKED_OUT',
        checkout_at = now(),
        checkout_consumos = COALESCE(p_consumos, '[]'::JSONB),
        checkout_consumos_total = v_consumos_total,
        checkout_metodo_pago = p_metodo_pago
    WHERE id = v_reservation.id
    RETURNING * INTO v_reservation;

    IF v_reservation.external_order_id IS NOT NULL THEN
      PERFORM public.append_alojamiento_outbox_event(
        'alojamiento.checkout.completado',
        v_reservation.external_order_id,
        p_correlation_id,
        jsonb_build_object(
          'orderId', v_reservation.id,
          'external_order_id', v_reservation.external_order_id,
          'saga_id', v_reservation.saga_id,
          'estado', 'CHECKED_OUT',
          'checkout_at', v_reservation.checkout_at
        )
      );
    END IF;
  END IF;

  SELECT string_agg(unit.codigo, ', ' ORDER BY unit.codigo)
  INTO v_room_codes
  FROM public.reservas_unidades_habitacion AS assignment
  JOIN public.unidades_habitacion AS unit ON unit.id = assignment.unidad_id
  WHERE assignment.reserva_id = v_reservation.id;

  SELECT CASE
           WHEN COUNT(*) = 0 THEN 'SIN_ASIGNACION'
           WHEN BOOL_OR(unit.estado = 'LIMPIEZA') THEN 'LIMPIEZA'
           WHEN BOOL_OR(unit.estado = 'OCUPADA') THEN 'OCUPADA'
           WHEN BOOL_OR(unit.estado = 'RESERVADA') THEN 'RESERVADA'
           ELSE 'DISPONIBLE'
         END,
         MAX(unit.limpieza_hasta) FILTER (WHERE unit.estado = 'LIMPIEZA')
  INTO v_room_state, v_cleaning_until
  FROM public.reservas_unidades_habitacion AS assignment
  JOIN public.unidades_habitacion AS unit ON unit.id = assignment.unidad_id
  WHERE assignment.reserva_id = v_reservation.id;

  v_result := jsonb_build_object(
    'orderId', v_reservation.id,
    'estado', 'CHECKED_OUT',
    'habitacionLiberada', COALESCE(v_room_codes, 'Sin habitación asignada'),
    'checkOutHora', v_reservation.checkout_at,
    'consumosAdicionales', to_char(
      COALESCE(v_consumos_total, 0),
      'FM9999999990.00'
    ),
    'claveDigitalRevocada', true,
    'limpiezaEstado', v_room_state,
    'limpiezaHasta', v_cleaning_until
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_alojamiento_checkin_room_state(
  p_reservation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.reservas;
  v_assigned_count INTEGER;
BEGIN
  SELECT * INTO v_reservation
  FROM public.reservas
  WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_reservation.estado_integracion <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_assigned_count
  FROM public.reservas_unidades_habitacion
  WHERE reserva_id = p_reservation_id;
  IF v_assigned_count < v_reservation.cantidad_habitaciones THEN
    RAISE EXCEPTION 'ROOM_ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reservas_unidades_habitacion AS assignment
    JOIN public.unidades_habitacion AS unit ON unit.id = assignment.unidad_id
    WHERE assignment.reserva_id = p_reservation_id
      AND unit.estado = 'LIMPIEZA'
      AND unit.limpieza_hasta > now()
  ) THEN
    RAISE EXCEPTION 'ROOM_STILL_CLEANING' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reservas_unidades_habitacion AS assignment
    JOIN public.unidades_habitacion AS unit ON unit.id = assignment.unidad_id
    JOIN public.reservas_unidades_habitacion AS prior_assignment
      ON prior_assignment.unidad_id = unit.id
     AND prior_assignment.reserva_id <> p_reservation_id
    JOIN public.reservas AS prior_reservation
      ON prior_reservation.id = prior_assignment.reserva_id
    WHERE assignment.reserva_id = p_reservation_id
      AND unit.estado = 'OCUPADA'
      AND prior_reservation.estado_integracion = 'CHECKED_IN'
  ) THEN
    RAISE EXCEPTION 'ROOM_STILL_OCCUPIED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_alojamiento_room_cleaning(
  p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.reservas;
  v_completed INTEGER;
  v_rooms JSONB;
BEGIN
  SELECT * INTO v_reservation
  FROM public.reservas
  WHERE id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_reservation.estado_integracion <> 'CHECKED_OUT' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.reservas_unidades_habitacion
    WHERE reserva_id = p_reservation_id
  ) THEN
    RAISE EXCEPTION 'ROOM_ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.unidades_habitacion AS unit
  SET estado = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.reservas_unidades_habitacion AS future_assignment
          JOIN public.reservas AS future_reservation
            ON future_reservation.id = future_assignment.reserva_id
          WHERE future_assignment.unidad_id = unit.id
            AND future_reservation.id <> p_reservation_id
            AND future_reservation.estado_integracion = 'CONFIRMED'
        ) THEN 'RESERVADA'
        ELSE 'DISPONIBLE'
      END,
      limpieza_inicio = NULL,
      limpieza_hasta = NULL
  FROM public.reservas_unidades_habitacion AS assignment
  WHERE assignment.reserva_id = p_reservation_id
    AND assignment.unidad_id = unit.id
    AND unit.estado = 'LIMPIEZA';
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'codigo', unit.codigo,
      'estado', unit.estado,
      'limpiezaHasta', unit.limpieza_hasta
    ) ORDER BY unit.codigo
  ), '[]'::JSONB)
  INTO v_rooms
  FROM public.reservas_unidades_habitacion AS assignment
  JOIN public.unidades_habitacion AS unit ON unit.id = assignment.unidad_id
  WHERE assignment.reserva_id = p_reservation_id;

  RETURN jsonb_build_object(
    'orderId', p_reservation_id,
    'habitaciones', v_rooms,
    'limpiezasCompletadas', v_completed,
    'yaEstabaLimpia', v_completed = 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_due_alojamiento_room_cleanings()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_completed INTEGER;
BEGIN
  WITH due_units AS (
    SELECT id
    FROM public.unidades_habitacion
    WHERE estado = 'LIMPIEZA'
      AND limpieza_hasta <= now()
    ORDER BY limpieza_hasta, id
    FOR UPDATE SKIP LOCKED
  ),
  completed_units AS (
    UPDATE public.unidades_habitacion AS unit
    SET estado = CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.reservas_unidades_habitacion AS assignment
            JOIN public.reservas AS reservation
              ON reservation.id = assignment.reserva_id
            WHERE assignment.unidad_id = unit.id
              AND reservation.estado_integracion = 'CONFIRMED'
          ) THEN 'RESERVADA'
          ELSE 'DISPONIBLE'
        END,
        limpieza_inicio = NULL,
        limpieza_hasta = NULL
    FROM due_units
    WHERE unit.id = due_units.id
    RETURNING unit.id
  )
  SELECT COUNT(*)::INTEGER INTO v_completed
  FROM completed_units;

  RETURN COALESCE(v_completed, 0);
END;
$$;

ALTER TABLE public.unidades_habitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservas_unidades_habitacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unidades_habitacion,
  public.reservas_unidades_habitacion
FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unidades_habitacion,
  public.reservas_unidades_habitacion TO service_role;

REVOKE ALL ON FUNCTION public.checkout_alojamiento_order_v2(
  TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_alojamiento_room_cleaning(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_alojamiento_checkin_room_state(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_due_alojamiento_room_cleanings()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_alojamiento_order_v2(
  TEXT, TEXT, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_alojamiento_room_cleaning(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_alojamiento_checkin_room_state(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_due_alojamiento_room_cleanings()
  TO service_role;
