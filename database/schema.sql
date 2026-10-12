-- Esquema de Alojamientos para PostgreSQL / Supabase.
-- Ejecutar en un proyecto nuevo o aplicar la migración si ya existía el
-- esquema anterior: database/migrations/20261007_contract_alignment.sql y
-- database/migrations/20261008_auth_and_rls.sql. Para favoritos en una base
-- existente, aplicar además database/migrations/202612100001_create_favoritos.sql.

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
  moneda VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (moneda ~ '^[A-Z]{3}$'),
  capacidad_maxima INTEGER NOT NULL CHECK (capacidad_maxima > 0),
  habitaciones_disponibles INTEGER NOT NULL DEFAULT 1
    CHECK (habitaciones_disponibles >= 0),
  servicios TEXT[] NOT NULL DEFAULT '{}',
  politica_cancelacion TEXT,
  urls_imagenes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reservas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alojamiento_id UUID NOT NULL
    REFERENCES public.alojamientos (id) ON DELETE RESTRICT,
  cliente_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  cliente_telefono TEXT,
  fecha_checkin DATE NOT NULL,
  fecha_checkout DATE NOT NULL,
  num_huespedes INTEGER NOT NULL CHECK (num_huespedes > 0),
  precio_total NUMERIC(12, 2) NOT NULL CHECK (precio_total >= 0),
  moneda VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (moneda ~ '^[A-Z]{3}$'),
  metodo_pago_simulado TEXT NOT NULL,
  pago_estado TEXT NOT NULL CHECK (pago_estado IN ('pendiente', 'exitoso', 'fallido')),
  pago_referencia UUID UNIQUE,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'confirmada', 'cancelada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reservas_fechas_validas CHECK (fecha_checkout > fecha_checkin)
);

CREATE TABLE IF NOT EXISTS public.eventos_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_evento TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.favoritos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  alojamiento_id UUID NOT NULL
    REFERENCES public.alojamientos (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT favoritos_cliente_alojamiento_unique
    UNIQUE (cliente_id, alojamiento_id)
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
  ON public.favoritos FOR SELECT TO authenticated
  USING (auth.uid() = cliente_id);
DROP POLICY IF EXISTS favoritos_insert_own ON public.favoritos;
CREATE POLICY favoritos_insert_own
  ON public.favoritos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = cliente_id);
DROP POLICY IF EXISTS favoritos_delete_own ON public.favoritos;
CREATE POLICY favoritos_delete_own
  ON public.favoritos FOR DELETE TO authenticated
  USING (auth.uid() = cliente_id);

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

-- Alojamientos de ejemplo en destinos reales de Ecuador.
INSERT INTO public.alojamientos (
  id,
  proveedor_id,
  nombre,
  descripcion,
  tipo,
  ciudad,
  direccion,
  latitud,
  longitud,
  precio_base_noche,
  moneda,
  capacidad_maxima,
  habitaciones_disponibles,
  servicios,
  politica_cancelacion,
  urls_imagenes
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Suite Familiar Quito',
    'Suite amplia ideal para familias, con acceso a los principales atractivos de Quito.',
    'hotel',
    'Quito',
    'Centro Histórico, Quito, Ecuador',
    -0.2202,
    -78.5123,
    85.00,
    'USD',
    4,
    2,
    ARRAY['wifi', 'desayuno', 'estacionamiento'],
    'Cancelación gratuita hasta 48 horas antes.',
    ARRAY['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80']
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'Cabaña Baños',
    'Cabaña acogedora rodeada de naturaleza, cerca de las termas y cascadas de Baños.',
    'villa',
    'Baños de Agua Santa',
    'Baños de Agua Santa, Tungurahua, Ecuador',
    -1.3964,
    -78.4247,
    72.50,
    'USD',
    3,
    1,
    ARRAY['wifi', 'terraza', 'vista a la montaña'],
    'Cancelación gratuita hasta 72 horas antes.',
    ARRAY['https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1200&q=80']
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    'Departamento frente al mar Santa Elena',
    'Departamento vacacional con vista al océano y acceso cercano a la playa.',
    'departamento',
    'Salinas',
    'Salinas, Santa Elena, Ecuador',
    -2.2049,
    -80.9686,
    110.00,
    'USD',
    5,
    2,
    ARRAY['wifi', 'piscina', 'vista al mar'],
    'Cancelación gratuita hasta 48 horas antes.',
    ARRAY['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80']
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    'Villa Jardín de Cuenca',
    'Villa privada con jardín, perfecta para una estancia tranquila en Cuenca.',
    'villa',
    'Cuenca',
    'Cuenca, Azuay, Ecuador',
    -2.9001,
    -79.0059,
    130.00,
    'USD',
    6,
    1,
    ARRAY['wifi', 'jardín', 'cocina equipada'],
    'Cancelación gratuita hasta 72 horas antes.',
    ARRAY['https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1200&q=80']
  )
ON CONFLICT (id) DO NOTHING;
