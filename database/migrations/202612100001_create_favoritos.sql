CREATE TABLE IF NOT EXISTS public.favoritos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  alojamiento_id uuid NOT NULL REFERENCES public.alojamientos (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favoritos_cliente_alojamiento_unique UNIQUE (cliente_id, alojamiento_id)
);

CREATE INDEX IF NOT EXISTS favoritos_cliente_created_at_idx
  ON public.favoritos (cliente_id, created_at DESC);

ALTER TABLE public.favoritos ENABLE ROW LEVEL SECURITY;

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

REVOKE ALL ON TABLE public.favoritos FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.favoritos TO authenticated;
