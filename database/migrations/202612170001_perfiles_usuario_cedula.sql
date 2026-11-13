-- Perfil de cada cuenta (cédula, nombre, teléfono) en una tabla visible en Supabase.
-- La API ya guarda la cédula en auth.users.raw_user_meta_data; esta tabla la
-- refleja automáticamente con un trigger y garantiza que no se repita.

CREATE TABLE IF NOT EXISTS public.perfiles_usuario (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT,
  nombre_completo TEXT,
  telefono TEXT,
  tipo_documento TEXT NOT NULL DEFAULT 'CEDULA',
  cedula TEXT CHECK (cedula IS NULL OR cedula ~ '^[0-9]{10}$'),
  rol TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS perfiles_usuario_cedula_unique
  ON public.perfiles_usuario (cedula)
  WHERE cedula IS NOT NULL;

ALTER TABLE public.perfiles_usuario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.perfiles_usuario FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.perfiles_usuario TO service_role;

-- Copia los datos del usuario de Auth a perfiles_usuario. Nunca bloquea el
-- registro: si la cédula ya está usada por otra cuenta, se guarda sin cédula.
CREATE OR REPLACE FUNCTION public.sync_perfil_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cedula TEXT := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'cedula', '')), '');
BEGIN
  IF v_cedula IS NOT NULL AND v_cedula !~ '^[0-9]{10}$' THEN
    v_cedula := NULL;
  END IF;

  BEGIN
    INSERT INTO public.perfiles_usuario AS p
      (user_id, email, nombre_completo, telefono, cedula, rol, updated_at)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'phone',
      v_cedula,
      COALESCE(NEW.raw_app_meta_data ->> 'role', NEW.raw_user_meta_data ->> 'role'),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      nombre_completo = EXCLUDED.nombre_completo,
      telefono = EXCLUDED.telefono,
      cedula = COALESCE(EXCLUDED.cedula, p.cedula),
      rol = EXCLUDED.rol,
      updated_at = CURRENT_TIMESTAMP;
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.perfiles_usuario AS p
      (user_id, email, nombre_completo, telefono, rol, updated_at)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'phone',
      COALESCE(NEW.raw_app_meta_data ->> 'role', NEW.raw_user_meta_data ->> 'role'),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      nombre_completo = EXCLUDED.nombre_completo,
      telefono = EXCLUDED.telefono,
      rol = EXCLUDED.rol,
      updated_at = CURRENT_TIMESTAMP;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_perfil_usuario ON auth.users;
CREATE TRIGGER sync_perfil_usuario
AFTER INSERT OR UPDATE OF email, raw_user_meta_data, raw_app_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_perfil_usuario();

-- Cuentas que ya existían sin cédula pero que Booking sincronizó como
-- huésped (por ejemplo Juan López): se toma la cédula de clientes_integracion.
UPDATE auth.users u
SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('cedula', c.identificacion, 'tipo_documento', 'CEDULA')
FROM public.clientes_integracion c
WHERE lower(c.email) = lower(u.email)
  AND c.tipo_documento = 'CEDULA'
  AND c.identificacion ~ '^[0-9]{10}$'
  AND COALESCE(u.raw_user_meta_data ->> 'cedula', '') = ''
  AND NOT EXISTS (
    SELECT 1 FROM auth.users o
    WHERE o.id <> u.id AND o.raw_user_meta_data ->> 'cedula' = c.identificacion
  );

-- Carga inicial de todas las cuentas existentes (dispara el trigger).
UPDATE auth.users SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb);
