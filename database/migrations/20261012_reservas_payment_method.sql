-- Restore the simulated payment method column required by the booking API.
-- The default preserves existing reservations when this migration runs.
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS metodo_pago_simulado TEXT NOT NULL
    DEFAULT 'no-especificado';

NOTIFY pgrst, 'reload schema';
