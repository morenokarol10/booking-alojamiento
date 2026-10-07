-- Esquema de Alojamientos para PostgreSQL / Supabase.
-- Ejecutar en un proyecto nuevo o aplicar la migración si ya existía el
-- esquema anterior: database/migrations/20261007_contract_alignment.sql y
-- database/migrations/20261008_auth_and_rls.sql

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

ALTER TABLE public.alojamientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos_log ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.alojamientos FROM anon, authenticated;
GRANT SELECT ON public.alojamientos TO anon, authenticated;
REVOKE ALL ON public.reservas, public.eventos_log FROM anon, authenticated;

DROP POLICY IF EXISTS alojamientos_public_read ON public.alojamientos;
CREATE POLICY alojamientos_public_read
  ON public.alojamientos FOR SELECT TO anon, authenticated USING (true);

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
