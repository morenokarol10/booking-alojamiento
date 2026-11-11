-- Camas por tipo de habitación y tipos de habitación para cada hospedaje.
-- Contrato v2.2.0: TipoHabitacionV2.camas (texto) + numero_camas (entero, aditivo).

ALTER TABLE public.tipos_habitacion
  ADD COLUMN IF NOT EXISTS numero_camas INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS camas TEXT,
  ADD COLUMN IF NOT EXISTS descripcion TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tipos_habitacion_numero_camas_check'
  ) THEN
    ALTER TABLE public.tipos_habitacion
      ADD CONSTRAINT tipos_habitacion_numero_camas_check
      CHECK (numero_camas BETWEEN 1 AND 10);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tipos_habitacion_camas_length_check'
  ) THEN
    ALTER TABLE public.tipos_habitacion
      ADD CONSTRAINT tipos_habitacion_camas_length_check
      CHECK (camas IS NULL OR char_length(camas) <= 100);
  END IF;
END;
$$;

-- Distribución de camas sugerida según la capacidad de la habitación.
CREATE OR REPLACE FUNCTION public.alojamientos_camas_por_capacidad(
  p_capacidad INTEGER
)
RETURNS TABLE (numero_camas INTEGER, camas TEXT)
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_capacidad <= 2 THEN 1
      WHEN p_capacidad <= 4 THEN 2
      ELSE LEAST(10, CEIL(p_capacidad / 2.0)::INTEGER)
    END,
    CASE
      WHEN p_capacidad <= 1 THEN '1 cama individual'
      WHEN p_capacidad = 2 THEN '1 cama matrimonial'
      WHEN p_capacidad = 3 THEN '1 cama matrimonial y 1 cama individual'
      WHEN p_capacidad = 4 THEN '2 camas matrimoniales'
      ELSE LEAST(10, CEIL(p_capacidad / 2.0)::INTEGER)::TEXT
        || ' camas matrimoniales'
    END
$$;

-- 1) Completar las camas de los tipos existentes que aún no las tienen.
UPDATE public.tipos_habitacion AS t
SET (numero_camas, camas) = (
  SELECT beds.numero_camas, beds.camas
  FROM public.alojamientos_camas_por_capacidad(t.capacidad_maxima) AS beds
)
WHERE t.camas IS NULL;

-- 2) Dar a cada hospedaje una oferta básica de habitaciones con camas.
--    Solo se agregan si el hospedaje aún no tiene ese código.
WITH base AS (
  SELECT DISTINCT ON (t.alojamiento_id)
    t.alojamiento_id,
    t.precio_base_noche,
    t.moneda,
    t.plan_tarifa_codigo,
    t.regimen
  FROM public.tipos_habitacion AS t
  ORDER BY t.alojamiento_id, (t.codigo = 'HABITACION_ESTANDAR') DESC, t.created_at
),
catalogo (codigo, nombre, capacidad, numero_camas, camas, descripcion, factor, cantidad) AS (
  VALUES
    ('HABITACION_SIMPLE', 'Habitación simple', 1, 1,
      '1 cama individual',
      'Ideal para una persona.', 0.80, 2),
    ('HABITACION_DOBLE', 'Habitación doble', 2, 2,
      '2 camas individuales',
      'Dos camas separadas para dos huéspedes.', 1.10, 3),
    ('HABITACION_FAMILIAR', 'Habitación familiar', 4, 3,
      '1 cama matrimonial y 2 camas individuales',
      'Espacio amplio para familias o grupos de hasta cuatro personas.', 1.60, 2)
)
INSERT INTO public.tipos_habitacion (
  alojamiento_id, codigo, nombre, capacidad_maxima, habitaciones_totales,
  precio_base_noche, moneda, plan_tarifa_codigo, regimen,
  numero_camas, camas, descripcion
)
SELECT
  b.alojamiento_id,
  c.codigo,
  c.nombre,
  c.capacidad,
  c.cantidad,
  ROUND(b.precio_base_noche * c.factor, 2),
  b.moneda,
  b.plan_tarifa_codigo,
  b.regimen,
  c.numero_camas,
  c.camas,
  c.descripcion
FROM base AS b
CROSS JOIN catalogo AS c
ON CONFLICT (alojamiento_id, codigo) DO NOTHING;

-- 3) Los hospedajes nuevos (creados desde el panel) reciben su habitación
--    estándar con camas para poder reservarse de inmediato.
CREATE OR REPLACE FUNCTION public.create_default_room_type_for_alojamiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_beds RECORD;
BEGIN
  SELECT * INTO v_beds
  FROM public.alojamientos_camas_por_capacidad(
    GREATEST(COALESCE(NEW.capacidad_maxima, 2), 1)
  );

  INSERT INTO public.tipos_habitacion (
    alojamiento_id, codigo, nombre, capacidad_maxima, habitaciones_totales,
    precio_base_noche, numero_camas, camas
  )
  VALUES (
    NEW.id,
    'HABITACION_ESTANDAR',
    'Habitación estándar',
    GREATEST(COALESCE(NEW.capacidad_maxima, 2), 1),
    GREATEST(COALESCE(NEW.habitaciones_disponibles, 1), 1),
    NEW.precio_base_noche,
    v_beds.numero_camas,
    v_beds.camas
  )
  ON CONFLICT (alojamiento_id, codigo) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alojamientos_create_default_room_type
  ON public.alojamientos;
CREATE TRIGGER alojamientos_create_default_room_type
  AFTER INSERT ON public.alojamientos
  FOR EACH ROW EXECUTE FUNCTION public.create_default_room_type_for_alojamiento();

REVOKE ALL ON FUNCTION public.create_default_room_type_for_alojamiento()
  FROM PUBLIC, anon, authenticated;

-- Verificación
SELECT a.codigo_integracion, t.codigo, t.nombre, t.capacidad_maxima,
       t.numero_camas, t.camas, t.habitaciones_totales, t.precio_base_noche
FROM public.tipos_habitacion AS t
JOIN public.alojamientos AS a ON a.id = t.alojamiento_id
ORDER BY a.codigo_integracion, t.precio_base_noche;
