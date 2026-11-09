CREATE TABLE IF NOT EXISTS public.clientes_integracion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_completo TEXT NOT NULL CHECK (length(nombre_completo) BETWEEN 3 AND 120),
  tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('CEDULA', 'PASAPORTE', 'RUC')),
  identificacion TEXT NOT NULL CHECK (length(identificacion) BETWEEN 6 AND 13),
  email TEXT NOT NULL UNIQUE,
  telefono TEXT NOT NULL,
  nacionalidad TEXT CHECK (nacionalidad IS NULL OR length(nacionalidad) <= 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.clientes_integracion ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.clientes_integracion TO service_role;

ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS huespedes_reales INTEGER
    CHECK (huespedes_reales IS NULL OR huespedes_reales BETWEEN 1 AND 20);
