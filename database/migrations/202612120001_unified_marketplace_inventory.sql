CREATE TABLE IF NOT EXISTS public.reservas_marketplace_idempotencia (
  idempotency_key UUID PRIMARY KEY,
  request_hash TEXT NOT NULL,
  reserva_id UUID REFERENCES public.reservas (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours'
);
ALTER TABLE public.reservas_marketplace_idempotencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservas_marketplace_idempotencia
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.reservas_marketplace_idempotencia TO service_role;

CREATE OR REPLACE FUNCTION public.book_accommodation_room_if_available(
  p_idempotency_key UUID,
  p_request_hash TEXT,
  p_alojamiento_id UUID,
  p_tipo_habitacion_codigo TEXT,
  p_cliente_id UUID,
  p_cliente_nombre TEXT,
  p_cliente_email TEXT,
  p_cliente_telefono TEXT,
  p_fecha_checkin DATE,
  p_fecha_checkout DATE,
  p_num_huespedes INTEGER,
  p_cantidad_habitaciones INTEGER,
  p_metodo_pago_simulado TEXT,
  p_pago_referencia UUID,
  p_cotizacion_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_idempotency public.reservas_marketplace_idempotencia;
  v_reservation public.reservas;
  v_room public.tipos_habitacion;
  v_quote public.cotizaciones_alojamiento;
  v_date DATE;
  v_available INTEGER;
  v_nights INTEGER;
  v_subtotal NUMERIC(12, 2);
  v_iva_porcentaje NUMERIC(5, 2);
  v_iva_valor NUMERIC(12, 2);
  v_tasa_municipal NUMERIC(12, 2);
  v_total NUMERIC(12, 2);
  v_breakdown JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR NULLIF(p_request_hash, '') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: idempotency key is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_fecha_checkout <= p_fecha_checkin OR
     p_fecha_checkin < timezone('America/Guayaquil', now())::DATE OR
     p_fecha_checkout - p_fecha_checkin > 30 THEN
    RAISE EXCEPTION 'INVALID_BOOKING_DATES' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad_habitaciones NOT BETWEEN 1 AND 10 OR
     p_num_huespedes NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: invalid room or guest count'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.reservas_marketplace_idempotencia
  WHERE idempotency_key = p_idempotency_key
    AND expires_at <= now();

  INSERT INTO public.reservas_marketplace_idempotencia (
    idempotency_key, request_hash
  )
  VALUES (p_idempotency_key, p_request_hash)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_idempotency
  FROM public.reservas_marketplace_idempotencia
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_idempotency.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
  END IF;
  IF v_idempotency.reserva_id IS NOT NULL THEN
    SELECT * INTO v_reservation
    FROM public.reservas
    WHERE id = v_idempotency.reserva_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'reservation', to_jsonb(v_reservation),
        'replayed', true
      );
    END IF;
  END IF;

  SELECT * INTO v_room
  FROM public.tipos_habitacion
  WHERE alojamiento_id = p_alojamiento_id
    AND codigo = p_tipo_habitacion_codigo
    AND activo = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF p_num_huespedes > v_room.capacidad_maxima * p_cantidad_habitaciones THEN
    RAISE EXCEPTION 'GUEST_CAPACITY_EXCEEDED' USING ERRCODE = '22023';
  END IF;

  PERFORM public.alojamientos_v2_validar_restricciones(
    v_room.id,
    p_fecha_checkin,
    p_fecha_checkout
  );

  PERFORM 1
  FROM public.inventario_diario
  WHERE tipo_habitacion_id = v_room.id
    AND fecha >= p_fecha_checkin
    AND fecha < p_fecha_checkout
  FOR SHARE;

  v_nights := p_fecha_checkout - p_fecha_checkin;
  SELECT COALESCE(a.iva_porcentaje, 15),
         COALESCE(a.tasa_municipal_por_noche, 0)
  INTO v_iva_porcentaje, v_tasa_municipal
  FROM public.alojamientos AS a
  WHERE a.id = p_alojamiento_id;

  IF p_cotizacion_id IS NOT NULL THEN
    SELECT * INTO v_quote
    FROM public.cotizaciones_alojamiento
    WHERE id = p_cotizacion_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QUOTE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_quote.valido_hasta <= now() THEN
      RAISE EXCEPTION 'QUOTE_EXPIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_quote.alojamiento_id <> p_alojamiento_id OR
       v_quote.tipo_habitacion_id <> v_room.id OR
       v_quote.fecha_inicio <> p_fecha_checkin OR
       v_quote.fecha_fin <> p_fecha_checkout OR
       v_quote.cantidad_habitaciones <> p_cantidad_habitaciones OR
       v_quote.currency <> 'USD' THEN
      RAISE EXCEPTION 'PRICE_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    v_total := v_quote.total_pagar;
    v_breakdown := v_quote.desglose;
  ELSE
    SELECT COALESCE(
      SUM(COALESCE(i.precio_noche, v_room.precio_base_noche)),
      0
    ) * p_cantidad_habitaciones
    INTO v_subtotal
    FROM GENERATE_SERIES(
      p_fecha_checkin,
      p_fecha_checkout - 1,
      INTERVAL '1 day'
    ) AS d(fecha)
    LEFT JOIN public.inventario_diario AS i
      ON i.tipo_habitacion_id = v_room.id AND i.fecha = d.fecha::DATE;

    v_iva_valor := round(v_subtotal * v_iva_porcentaje / 100, 2);
    v_total := v_subtotal + v_iva_valor +
      (v_tasa_municipal * p_cantidad_habitaciones * v_nights);
    v_breakdown := jsonb_build_object(
      'subtotal', to_char(v_subtotal, 'FM9999999990.00'),
      'ivaPorcentaje', v_iva_porcentaje,
      'ivaValor', to_char(v_iva_valor, 'FM9999999990.00'),
      'tasaMunicipal', to_char(
        v_tasa_municipal * p_cantidad_habitaciones * v_nights,
        'FM9999999990.00'
      ),
      'totalPagar', to_char(v_total, 'FM9999999990.00')
    );
  END IF;

  FOR v_date IN
    SELECT generate_series(
      p_fecha_checkin,
      p_fecha_checkout - 1,
      INTERVAL '1 day'
    )::DATE
  LOOP
    SELECT d.habitaciones_remanentes INTO v_available
    FROM public.alojamientos_v2_disponibilidad(
      v_room.id,
      v_date,
      v_date + 1
    ) AS d;
    IF COALESCE(v_available, 0) < p_cantidad_habitaciones THEN
      RAISE EXCEPTION 'NO_ROOMS_AVAILABLE' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO public.reservas (
    cliente_id,
    alojamiento_id,
    tipo_habitacion_id,
    cliente_nombre,
    cliente_email,
    cliente_telefono,
    fecha_checkin,
    fecha_checkout,
    num_huespedes,
    cantidad_habitaciones,
    precio_total,
    moneda,
    metodo_pago_simulado,
    pago_estado,
    pago_referencia,
    estado,
    estado_integracion,
    cotizacion_id,
    payment_method,
    payment_reference,
    ocupantes,
    modelo_pago,
    desglose_fiscal
  )
  VALUES (
    p_cliente_id,
    p_alojamiento_id,
    v_room.id,
    p_cliente_nombre,
    p_cliente_email,
    p_cliente_telefono,
    p_fecha_checkin,
    p_fecha_checkout,
    p_num_huespedes,
    p_cantidad_habitaciones,
    v_total,
    v_room.moneda,
    p_metodo_pago_simulado,
    'exitoso',
    p_pago_referencia,
    'confirmada',
    'CONFIRMED',
    p_cotizacion_id,
    p_metodo_pago_simulado,
    p_pago_referencia::TEXT,
    jsonb_build_object('adultos', p_num_huespedes, 'ninos', 0),
    'PAGO_SIMULADO',
    v_breakdown
  )
  RETURNING * INTO v_reservation;

  UPDATE public.reservas_marketplace_idempotencia
  SET reserva_id = v_reservation.id
  WHERE idempotency_key = p_idempotency_key;

  RETURN jsonb_build_object(
    'reservation', to_jsonb(v_reservation),
    'replayed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.book_accommodation_if_available(
  p_alojamiento_id UUID,
  p_cliente_id UUID,
  p_cliente_nombre TEXT,
  p_cliente_email TEXT,
  p_cliente_telefono TEXT,
  p_fecha_checkin DATE,
  p_fecha_checkout DATE,
  p_num_huespedes INTEGER,
  p_precio_total NUMERIC,
  p_moneda TEXT,
  p_metodo_pago_simulado TEXT,
  p_pago_referencia UUID
)
RETURNS SETOF public.reservas
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_code TEXT;
  v_result JSONB;
BEGIN
  SELECT codigo INTO v_room_code
  FROM public.tipos_habitacion
  WHERE alojamiento_id = p_alojamiento_id
    AND activo = true
  ORDER BY (codigo = 'HABITACION_ESTANDAR') DESC, precio_base_noche
  LIMIT 1;
  IF v_room_code IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT public.book_accommodation_room_if_available(
    gen_random_uuid(),
    md5(concat_ws(
      '|',
      p_alojamiento_id,
      p_cliente_id,
      p_fecha_checkin,
      p_fecha_checkout,
      p_num_huespedes,
      p_metodo_pago_simulado,
      p_pago_referencia
    )),
    p_alojamiento_id,
    v_room_code,
    p_cliente_id,
    p_cliente_nombre,
    p_cliente_email,
    p_cliente_telefono,
    p_fecha_checkin,
    p_fecha_checkout,
    p_num_huespedes,
    1,
    p_metodo_pago_simulado,
    p_pago_referencia,
    NULL
  ) INTO v_result;

  RETURN QUERY
  SELECT (jsonb_populate_record(
    NULL::public.reservas,
    v_result->'reservation'
  )).*;
END;
$$;

REVOKE ALL ON FUNCTION public.book_accommodation_room_if_available(
  UUID, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT,
  DATE, DATE, INTEGER, INTEGER, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_accommodation_room_if_available(
  UUID, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT,
  DATE, DATE, INTEGER, INTEGER, TEXT, UUID, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';
