-- Compatibilidad con el contrato de integración v2.2.0
-- Ejecutar después de los scripts existentes del proyecto y antes de desplegar
-- una nueva instancia de Render o de recargar el esquema de Supabase.

CREATE TABLE IF NOT EXISTS public.alojamientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id UUID NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('hotel', 'departamento', 'villa')),
  ciudad TEXT NOT NULL,
  direccion TEXT NOT NULL,
  latitud DOUBLE PRECISION NOT NULL,
  longitud DOUBLE PRECISION NOT NULL,
  precio_base_noche NUMERIC(12, 2) NOT NULL CHECK (precio_base_noche >= 0),
  moneda VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (moneda ~ '^[A-Z]{3}$'),
  capacidad_maxima INTEGER NOT NULL CHECK (capacidad_maxima > 0),
  habitaciones_disponibles INTEGER NOT NULL DEFAULT 1 CHECK (habitaciones_disponibles >= 0),
  servicios TEXT[] NOT NULL DEFAULT '{}',
  politica_cancelacion TEXT,
  urls_imagenes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.alojamientos
  ADD COLUMN IF NOT EXISTS proveedor_id UUID,
  ADD COLUMN IF NOT EXISTS descripcion TEXT,
  ADD COLUMN IF NOT EXISTS tipo TEXT,
  ADD COLUMN IF NOT EXISTS ciudad TEXT,
  ADD COLUMN IF NOT EXISTS direccion TEXT,
  ADD COLUMN IF NOT EXISTS latitud DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitud DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS precio_base_noche NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS capacidad_maxima INTEGER,
  ADD COLUMN IF NOT EXISTS habitaciones_disponibles INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS servicios TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS politica_cancelacion TEXT,
  ADD COLUMN IF NOT EXISTS urls_imagenes TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

UPDATE public.alojamientos
SET tipo = COALESCE(tipo, 'hotel')
WHERE tipo IS NULL;

UPDATE public.alojamientos
SET moneda = COALESCE(moneda, 'USD')
WHERE moneda IS NULL;

UPDATE public.alojamientos
SET capacidad_maxima = COALESCE(capacidad_maxima, 1)
WHERE capacidad_maxima IS NULL;

UPDATE public.alojamientos
SET habitaciones_disponibles = COALESCE(habitaciones_disponibles, 1)
WHERE habitaciones_disponibles IS NULL;

ALTER TABLE public.alojamientos
  ALTER COLUMN proveedor_id SET NOT NULL,
  ALTER COLUMN tipo SET NOT NULL,
  ALTER COLUMN ciudad SET NOT NULL,
  ALTER COLUMN direccion SET NOT NULL,
  ALTER COLUMN latitud SET NOT NULL,
  ALTER COLUMN longitud SET NOT NULL,
  ALTER COLUMN precio_base_noche SET NOT NULL,
  ALTER COLUMN moneda SET NOT NULL,
  ALTER COLUMN capacidad_maxima SET NOT NULL,
  ALTER COLUMN habitaciones_disponibles SET NOT NULL,
  ALTER COLUMN servicios SET DEFAULT '{}',
  ALTER COLUMN urls_imagenes SET DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.reservas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alojamiento_id UUID NOT NULL REFERENCES public.alojamientos (id) ON DELETE RESTRICT,
  cliente_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  cliente_telefono TEXT,
  fecha_checkin DATE NOT NULL,
  fecha_checkout DATE NOT NULL,
  num_huespedes INTEGER NOT NULL CHECK (num_huespedes > 0),
  precio_total NUMERIC(12, 2) NOT NULL CHECK (precio_total >= 0),
  moneda VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (moneda ~ '^[A-Z]{3}$'),
  metodo_pago_simulado TEXT NOT NULL,
  pago_estado TEXT NOT NULL CHECK (pago_estado IN ('pendiente', 'exitoso', 'fallido')),
  pago_referencia UUID UNIQUE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmada', 'cancelada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reservas_fechas_validas CHECK (fecha_checkout > fecha_checkin)
);

ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS cliente_id UUID,
  ADD COLUMN IF NOT EXISTS cliente_nombre TEXT,
  ADD COLUMN IF NOT EXISTS cliente_email TEXT,
  ADD COLUMN IF NOT EXISTS cliente_telefono TEXT,
  ADD COLUMN IF NOT EXISTS fecha_checkin DATE,
  ADD COLUMN IF NOT EXISTS fecha_checkout DATE,
  ADD COLUMN IF NOT EXISTS num_huespedes INTEGER,
  ADD COLUMN IF NOT EXISTS precio_total NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS metodo_pago_simulado TEXT DEFAULT 'no-especificado',
  ADD COLUMN IF NOT EXISTS pago_estado TEXT DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS pago_referencia UUID,
  ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

UPDATE public.reservas
SET cliente_nombre = COALESCE(cliente_nombre, 'Cliente'),
    cliente_email = COALESCE(cliente_email, 'sin-email@local.test'),
    fecha_checkin = COALESCE(fecha_checkin, CURRENT_DATE),
    fecha_checkout = COALESCE(fecha_checkout, CURRENT_DATE + 1),
    num_huespedes = COALESCE(num_huespedes, 1),
    precio_total = COALESCE(precio_total, 0),
    moneda = COALESCE(moneda, 'USD'),
    metodo_pago_simulado = COALESCE(metodo_pago_simulado, 'no-especificado'),
    pago_estado = COALESCE(pago_estado, 'pendiente'),
    estado = COALESCE(estado, 'pendiente')
WHERE cliente_nombre IS NULL
   OR cliente_email IS NULL
   OR fecha_checkin IS NULL
   OR fecha_checkout IS NULL
   OR num_huespedes IS NULL
   OR precio_total IS NULL;

ALTER TABLE public.reservas
  ALTER COLUMN cliente_nombre SET NOT NULL,
  ALTER COLUMN cliente_email SET NOT NULL,
  ALTER COLUMN fecha_checkin SET NOT NULL,
  ALTER COLUMN fecha_checkout SET NOT NULL,
  ALTER COLUMN num_huespedes SET NOT NULL,
  ALTER COLUMN precio_total SET NOT NULL,
  ALTER COLUMN moneda SET NOT NULL,
  ALTER COLUMN metodo_pago_simulado SET NOT NULL,
  ALTER COLUMN pago_estado SET NOT NULL,
  ALTER COLUMN estado SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.eventos_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_evento TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.favoritos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  alojamiento_id UUID NOT NULL REFERENCES public.alojamientos (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT favoritos_cliente_alojamiento_unique UNIQUE (cliente_id, alojamiento_id)
);

CREATE INDEX IF NOT EXISTS alojamientos_ciudad_idx
  ON public.alojamientos (ciudad);

CREATE INDEX IF NOT EXISTS alojamientos_precio_idx
  ON public.alojamientos (precio_base_noche);

CREATE INDEX IF NOT EXISTS reservas_alojamiento_id_idx
  ON public.reservas (alojamiento_id);

CREATE INDEX IF NOT EXISTS reservas_cliente_id_idx
  ON public.reservas (cliente_id);

CREATE INDEX IF NOT EXISTS reservas_fechas_idx
  ON public.reservas (fecha_checkin, fecha_checkout);

CREATE INDEX IF NOT EXISTS eventos_log_creado_en_idx
  ON public.eventos_log (creado_en DESC);

CREATE INDEX IF NOT EXISTS favoritos_cliente_created_at_idx
  ON public.favoritos (cliente_id, created_at DESC);

ALTER TABLE public.alojamientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favoritos ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.alojamientos FROM anon, authenticated;
GRANT SELECT ON public.alojamientos TO anon, authenticated;
REVOKE ALL ON public.reservas, public.eventos_log FROM anon, authenticated;
REVOKE ALL ON public.favoritos FROM anon;
GRANT SELECT, INSERT, DELETE ON public.favoritos TO authenticated;

DROP POLICY IF EXISTS alojamientos_public_read ON public.alojamientos;
CREATE POLICY alojamientos_public_read
  ON public.alojamientos FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS favoritos_select_own ON public.favoritos;
CREATE POLICY favoritos_select_own
  ON public.favoritos FOR SELECT TO authenticated USING (auth.uid() = cliente_id);

DROP POLICY IF EXISTS favoritos_insert_own ON public.favoritos;
CREATE POLICY favoritos_insert_own
  ON public.favoritos FOR INSERT TO authenticated WITH CHECK (auth.uid() = cliente_id);

DROP POLICY IF EXISTS favoritos_delete_own ON public.favoritos;
CREATE POLICY favoritos_delete_own
  ON public.favoritos FOR DELETE TO authenticated USING (auth.uid() = cliente_id);

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
