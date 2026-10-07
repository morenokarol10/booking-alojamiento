DO $$
BEGIN
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

  UPDATE public.alojamientos
  SET urls_imagenes = '{}'::TEXT[]
  WHERE urls_imagenes IS NULL;

  ALTER TABLE public.alojamientos
    ALTER COLUMN urls_imagenes SET DEFAULT '{}'::TEXT[],
    ALTER COLUMN urls_imagenes SET NOT NULL;
END $$;

NOTIFY pgrst, 'reload schema';
