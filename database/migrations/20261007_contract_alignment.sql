-- Migración de las tablas iniciales (titulo/ubicacion/precio_por_noche) al
-- modelo camelCase de la API con columnas snake_case en PostgreSQL.
-- Hace falta ejecutar esta migración una vez en proyectos donde ya se aplicó
-- el schema.sql inicial. En bases nuevas, ejecutar database/schema.sql.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'titulo'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'nombre'
  ) THEN
    ALTER TABLE public.alojamientos RENAME COLUMN titulo TO nombre;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'ubicacion'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'ciudad'
  ) THEN
    ALTER TABLE public.alojamientos RENAME COLUMN ubicacion TO ciudad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'precio_por_noche'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'precio_base_noche'
  ) THEN
    ALTER TABLE public.alojamientos
      RENAME COLUMN precio_por_noche TO precio_base_noche;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'capacidad_personas'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'capacidad_maxima'
  ) THEN
    ALTER TABLE public.alojamientos
      RENAME COLUMN capacidad_personas TO capacidad_maxima;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas'
      AND column_name = 'fecha_inicio'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas'
      AND column_name = 'fecha_checkin'
  ) THEN
    ALTER TABLE public.reservas RENAME COLUMN fecha_inicio TO fecha_checkin;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas'
      AND column_name = 'fecha_fin'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas'
      AND column_name = 'fecha_checkout'
  ) THEN
    ALTER TABLE public.reservas RENAME COLUMN fecha_fin TO fecha_checkout;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas'
      AND column_name = 'total'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas'
      AND column_name = 'precio_total'
  ) THEN
    ALTER TABLE public.reservas RENAME COLUMN total TO precio_total;
  END IF;
END $$;

ALTER TABLE public.alojamientos
  ADD COLUMN IF NOT EXISTS proveedor_id UUID,
  ADD COLUMN IF NOT EXISTS direccion TEXT,
  ADD COLUMN IF NOT EXISTS latitud DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitud DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS habitaciones_disponibles INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS servicios TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS politica_cancelacion TEXT,
  ADD COLUMN IF NOT EXISTS imagenes TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.alojamientos
SET proveedor_id = gen_random_uuid()
WHERE proveedor_id IS NULL;

UPDATE public.alojamientos
SET direccion = ciudad
WHERE direccion IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'coordenadas'
  ) THEN
    EXECUTE $migration$
      UPDATE public.alojamientos
      SET latitud = COALESCE((coordenadas->>'latitud')::DOUBLE PRECISION, -0.1807),
          longitud = COALESCE((coordenadas->>'longitud')::DOUBLE PRECISION, -78.4678)
      WHERE latitud IS NULL OR longitud IS NULL
    $migration$;
    ALTER TABLE public.alojamientos DROP COLUMN coordenadas;
  END IF;

  UPDATE public.alojamientos
  SET latitud = COALESCE(latitud, -0.1807),
      longitud = COALESCE(longitud, -78.4678)
  WHERE latitud IS NULL OR longitud IS NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'imagen_url'
  ) THEN
    EXECUTE
      'UPDATE public.alojamientos SET imagenes = ARRAY[imagen_url] WHERE imagen_url IS NOT NULL AND cardinality(imagenes) = 0';
    ALTER TABLE public.alojamientos DROP COLUMN imagen_url;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'disponible'
  ) THEN
    EXECUTE
      'UPDATE public.alojamientos SET habitaciones_disponibles = CASE WHEN disponible THEN 1 ELSE 0 END';
    ALTER TABLE public.alojamientos DROP COLUMN disponible;
  END IF;
END $$;

ALTER TABLE public.alojamientos
  ALTER COLUMN proveedor_id SET NOT NULL,
  ALTER COLUMN direccion SET NOT NULL,
  ALTER COLUMN latitud SET NOT NULL,
  ALTER COLUMN longitud SET NOT NULL;

ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS cliente_telefono TEXT,
  ADD COLUMN IF NOT EXISTS num_huespedes INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS metodo_pago_simulado TEXT NOT NULL DEFAULT 'no-especificado',
  ADD COLUMN IF NOT EXISTS pago_estado TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS pago_referencia UUID;

CREATE UNIQUE INDEX IF NOT EXISTS reservas_pago_referencia_idx
  ON public.reservas (pago_referencia)
  WHERE pago_referencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS alojamientos_ciudad_idx
  ON public.alojamientos (ciudad);

CREATE INDEX IF NOT EXISTS alojamientos_precio_idx
  ON public.alojamientos (precio_base_noche);

CREATE INDEX IF NOT EXISTS reservas_fechas_idx
  ON public.reservas (fecha_checkin, fecha_checkout);

CREATE INDEX IF NOT EXISTS eventos_log_creado_en_idx
  ON public.eventos_log (creado_en DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alojamientos_moneda_formato'
      AND conrelid = 'public.alojamientos'::regclass
  ) THEN
    ALTER TABLE public.alojamientos
      ADD CONSTRAINT alojamientos_moneda_formato CHECK (moneda ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservas_moneda_formato'
      AND conrelid = 'public.reservas'::regclass
  ) THEN
    ALTER TABLE public.reservas
      ADD CONSTRAINT reservas_moneda_formato CHECK (moneda ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservas_pago_estado_valido'
      AND conrelid = 'public.reservas'::regclass
  ) THEN
    ALTER TABLE public.reservas
      ADD CONSTRAINT reservas_pago_estado_valido
      CHECK (pago_estado IN ('pendiente', 'exitoso', 'fallido'));
  END IF;
END $$;
