-- Align the deployed Supabase table with the columns used by the API.
-- Safe to re-run when deploying a project whose earlier migrations were skipped.
ALTER TABLE public.alojamientos
  ADD COLUMN IF NOT EXISTS servicios TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS latitud DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitud DOUBLE PRECISION;

DO $$
DECLARE
  services_type TEXT;
BEGIN
  SELECT udt_name INTO services_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'alojamientos'
    AND column_name = 'servicios';

  IF services_type = 'text' THEN
    ALTER TABLE public.alojamientos
      ALTER COLUMN servicios TYPE TEXT[]
      USING CASE
        WHEN servicios IS NULL OR btrim(servicios) = '' THEN '{}'::TEXT[]
        ELSE string_to_array(servicios, ',')
      END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'urls_imagenes'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'alojamientos'
        AND column_name = 'imagenes'
    ) THEN
      ALTER TABLE public.alojamientos
        RENAME COLUMN imagenes TO urls_imagenes;
    ELSE
      ALTER TABLE public.alojamientos
        ADD COLUMN urls_imagenes TEXT[] NOT NULL DEFAULT '{}';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'imagenes'
  ) THEN
    UPDATE public.alojamientos
    SET urls_imagenes = imagenes
    WHERE cardinality(urls_imagenes) = 0
      AND cardinality(imagenes) > 0;
    ALTER TABLE public.alojamientos DROP COLUMN imagenes;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alojamientos'
      AND column_name = 'imagen_url'
  ) THEN
    UPDATE public.alojamientos
    SET urls_imagenes = ARRAY[imagen_url]
    WHERE imagen_url IS NOT NULL
      AND cardinality(urls_imagenes) = 0;
    ALTER TABLE public.alojamientos DROP COLUMN imagen_url;
  END IF;

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
      longitud = COALESCE(longitud, -78.4678),
      servicios = COALESCE(servicios, '{}'::TEXT[]),
      urls_imagenes = COALESCE(urls_imagenes, '{}'::TEXT[])
  WHERE latitud IS NULL OR longitud IS NULL OR servicios IS NULL
    OR urls_imagenes IS NULL;

  ALTER TABLE public.alojamientos
    ALTER COLUMN latitud SET NOT NULL,
    ALTER COLUMN longitud SET NOT NULL,
    ALTER COLUMN servicios SET DEFAULT '{}'::TEXT[],
    ALTER COLUMN servicios SET NOT NULL,
    ALTER COLUMN urls_imagenes SET DEFAULT '{}'::TEXT[],
    ALTER COLUMN urls_imagenes SET NOT NULL;
END $$;

NOTIFY pgrst, 'reload schema';
