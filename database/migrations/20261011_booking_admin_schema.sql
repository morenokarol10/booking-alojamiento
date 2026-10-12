-- Repair existing Supabase projects where the customer reservation column
-- was missing or an earlier auth migration was skipped.
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS cliente_id UUID
    REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reservas_cliente_id_idx
  ON public.reservas (cliente_id);

NOTIFY pgrst, 'reload schema';
