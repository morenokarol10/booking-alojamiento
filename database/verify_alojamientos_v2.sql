SELECT
  to_regclass('public.tipos_habitacion') AS tipos_habitacion,
  to_regclass('public.inventario_diario') AS inventario_diario,
  to_regclass('public.cotizaciones_alojamiento') AS cotizaciones,
  to_regclass('public.integracion_idempotencia') AS idempotencia,
  to_regclass('public.integracion_outbox') AS outbox;

SELECT
  to_regprocedure('public.alojamientos_v2_disponibilidad(uuid,date,date)')
    AS disponibilidad,
  to_regprocedure(
    'public.create_alojamiento_order_v2(uuid,text,jsonb,text)'
  ) AS crear_orden,
  to_regprocedure(
    'public.cancel_alojamiento_order_v2(uuid,text,text,text,text)'
  ) AS cancelar_orden,
  to_regprocedure('public.claim_alojamiento_stock_outbox(integer)')
    AS reclamar_outbox,
  to_regprocedure(
    'public.finish_alojamiento_stock_outbox(uuid,boolean,text)'
  ) AS confirmar_outbox;

SELECT
  c.relname AS tabla,
  c.relrowsecurity AS rls_habilitado
FROM pg_class AS c
WHERE c.oid IN (
  to_regclass('public.tipos_habitacion'),
  to_regclass('public.inventario_diario'),
  to_regclass('public.cotizaciones_alojamiento'),
  to_regclass('public.integracion_idempotencia'),
  to_regclass('public.integracion_outbox')
)
ORDER BY c.relname;

SELECT
  c.relname AS tabla,
  t.tgname AS trigger
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname IN (
    'reservas_sync_stock_outbox',
    'inventario_diario_sync_stock_outbox'
  )
ORDER BY c.relname, t.tgname;
