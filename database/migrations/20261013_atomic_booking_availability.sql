-- Complete the reservation columns needed by the API on existing projects.
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS cliente_id UUID
    REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cliente_telefono TEXT,
  ADD COLUMN IF NOT EXISTS num_huespedes INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS metodo_pago_simulado TEXT NOT NULL
    DEFAULT 'no-especificado',
  ADD COLUMN IF NOT EXISTS pago_estado TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS pago_referencia UUID,
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'pendiente';

CREATE INDEX IF NOT EXISTS reservas_cliente_id_idx
  ON public.reservas (cliente_id);

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
  v_habitaciones_disponibles INTEGER;
  v_capacidad_maxima INTEGER;
  v_reservas_superpuestas BIGINT;
BEGIN
  IF p_fecha_checkout <= p_fecha_checkin THEN
    RAISE EXCEPTION 'INVALID_BOOKING_DATES' USING ERRCODE = '22023';
  END IF;

  -- Serialize bookings for this accommodation before counting overlaps.
  SELECT habitaciones_disponibles, capacidad_maxima
    INTO v_habitaciones_disponibles, v_capacidad_maxima
    FROM public.alojamientos
    WHERE id = p_alojamiento_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOMMODATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_num_huespedes > v_capacidad_maxima THEN
    RAISE EXCEPTION 'GUEST_CAPACITY_EXCEEDED' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
    INTO v_reservas_superpuestas
    FROM public.reservas
    WHERE alojamiento_id = p_alojamiento_id
      AND estado IS DISTINCT FROM 'cancelada'
      AND fecha_checkin < p_fecha_checkout
      AND fecha_checkout > p_fecha_checkin;

  IF v_reservas_superpuestas >= v_habitaciones_disponibles THEN
    RAISE EXCEPTION 'NO_ROOMS_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    INSERT INTO public.reservas (
      alojamiento_id,
      cliente_id,
      cliente_nombre,
      cliente_email,
      cliente_telefono,
      fecha_checkin,
      fecha_checkout,
      num_huespedes,
      precio_total,
      moneda,
      metodo_pago_simulado,
      pago_estado,
      pago_referencia,
      estado
    )
    VALUES (
      p_alojamiento_id,
      p_cliente_id,
      p_cliente_nombre,
      p_cliente_email,
      p_cliente_telefono,
      p_fecha_checkin,
      p_fecha_checkout,
      p_num_huespedes,
      p_precio_total,
      p_moneda,
      p_metodo_pago_simulado,
      'exitoso',
      p_pago_referencia,
      'confirmada'
    )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.book_accommodation_if_available(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, NUMERIC, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_accommodation_if_available(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, NUMERIC, TEXT, TEXT, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';
