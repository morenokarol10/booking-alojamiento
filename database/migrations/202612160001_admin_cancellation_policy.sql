-- Cancelación por administradores/empleados y política de reembolso.
-- 1) Corrige el CHECK de integracion_outbox: el check-out de órdenes de
--    Booking emite 'alojamiento.checkout.completado' y era rechazado.
-- 2) Guarda quién canceló, cuándo, el motivo y el reembolso aplicado.
-- 3) cancel_alojamiento_order_v2: reembolso 100 % si cancela el hotel y
--    soporte para reservas del sitio (sin external_order_id).

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.integracion_outbox'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%alojamiento.reserva.confirmada%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.integracion_outbox DROP CONSTRAINT %I',
      v_constraint
    );
  END LOOP;
END;
$$;

ALTER TABLE public.integracion_outbox
  ADD CONSTRAINT integracion_outbox_type_check CHECK (type IN (
    'alojamiento.reserva.confirmada',
    'alojamiento.reserva.cancelada',
    'alojamiento.checkout.completado',
    'alojamiento.stock.actualizado'
  ));

ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS cancelada_por TEXT,
  ADD COLUMN IF NOT EXISTS cancelada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT,
  ADD COLUMN IF NOT EXISTS porcentaje_reembolso NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS monto_reembolsado NUMERIC(12, 2);

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
  v_refund_code TEXT;
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
    SELECT response_body INTO v_result
    FROM public.integracion_idempotencia
    WHERE operation = 'CANCEL_ORDER'
      AND response_body->>'orderId' = v_reservation.id::TEXT
      AND response_body->>'yaCancelada' = 'false'
    ORDER BY created_at ASC, idempotency_key ASC
    LIMIT 1;

    IF v_result IS NOT NULL THEN
      v_refund_code := NULLIF(v_result->>'codigoReembolso', '');
    END IF;
    IF v_refund_code IS NULL OR
       v_refund_code !~ '^REF-HTL-[0-9]{5,10}$'
    THEN
      v_refund_code := v_reservation.codigo_reembolso;
    END IF;
    IF v_refund_code IS NULL OR
       v_refund_code !~ '^REF-HTL-[0-9]{5,10}$'
    THEN
      v_refund_code :=
        'REF-HTL-' || nextval('public.alojamientos_refund_code_seq')::TEXT;
    END IF;
    UPDATE public.reservas
    SET codigo_reembolso = v_refund_code
    WHERE id = v_reservation.id;

    IF v_result IS NULL THEN
      v_refund_percent := 0;
      v_refund := 0;
      v_penalty := v_reservation.precio_total;
      v_result := jsonb_build_object(
        'orderId', v_reservation.id,
        'external_order_id', v_reservation.external_order_id,
        'estado', 'CANCELLED',
        'refundStatus', 'NO_REFUND',
        'codigoReembolso', v_refund_code,
        'porcentajeReembolso', 0,
        'montoReembolsado', '0.00',
        'penalidad', to_char(v_penalty, 'FM9999999990.00'),
        'cuposRestaurados', true,
        'yaCancelada', true,
        'timestamp', now()
      );
    ELSE
      v_result := jsonb_set(
        v_result,
        '{codigoReembolso}',
        to_jsonb(v_refund_code),
        true
      ) || jsonb_build_object('yaCancelada', true);
    END IF;
  ELSE
    -- Política: reembolso 100 % hasta 48 h antes del check-in (14:00
    -- Guayaquil); después, sin reembolso. Si cancela el hotel o la Saga
    -- (compensación), siempre se reembolsa el 100 %.
    IF p_requested_by IN ('SAGA_ORCHESTRATOR', 'HOTEL') OR
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
        cancelada_por = p_requested_by,
        cancelada_en = now(),
        porcentaje_reembolso = v_refund_percent,
        monto_reembolsado = v_refund,
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
        WHEN v_refund_percent = 100 THEN 'REFUNDED'
        ELSE 'COMPENSATED'
      END,
      'codigoReembolso', v_reservation.codigo_reembolso,
      'porcentajeReembolso', v_refund_percent,
      'montoReembolsado', to_char(v_refund, 'FM9999999990.00'),
      'penalidad', to_char(v_penalty, 'FM9999999990.00'),
      'cuposRestaurados', true,
      'canceladaPor', p_requested_by,
      'yaCancelada', false,
      'timestamp', now()
    );

    -- Solo las reservas de Booking generan evento para Booking; las del
    -- sitio no tienen external_order_id. El stock se sincroniza por trigger.
    IF v_reservation.external_order_id IS NOT NULL THEN
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
  END IF;

  UPDATE public.integracion_idempotencia
  SET response_body = v_result
  WHERE idempotency_key = p_idempotency_key
    AND operation = 'CANCEL_ORDER';

  RETURN v_result || jsonb_build_object('_idempotent_replayed', false);
END;
$$;
