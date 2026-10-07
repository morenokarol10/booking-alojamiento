-- Ejecutar después de 20261007_contract_alignment.sql en bases existentes.
-- Las escrituras pasan por la API NestJS, que autentica usuarios y usa una
-- clave service-role exclusivamente del lado servidor.

ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS cliente_id UUID
    REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reservas_cliente_id_idx
  ON public.reservas (cliente_id);

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
