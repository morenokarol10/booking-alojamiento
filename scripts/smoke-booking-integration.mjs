import { randomUUID } from 'node:crypto';

const apiBaseUrl = required('E2E_BASE_URL').replace(/\/+$/, '');
const propertyId = required('E2E_ALOJAMIENTO_ID');
const checkin = required('E2E_CHECKIN');
const checkout = required('E2E_CHECKOUT');
const roomCount = positiveInteger(process.env.E2E_HABITACIONES ?? '1', 'E2E_HABITACIONES');
const adults = positiveInteger(process.env.E2E_ADULTOS ?? '2', 'E2E_ADULTOS');
const children = nonNegativeInteger(process.env.E2E_NINOS ?? '0', 'E2E_NINOS');
const baseUrl = new URL(apiBaseUrl);

if (baseUrl.protocol !== 'https:') {
  throw new Error('E2E_BASE_URL must use HTTPS.');
}
if (!baseUrl.pathname.replace(/\/+$/, '').endsWith('/api/v2')) {
  throw new Error('E2E_BASE_URL must end in /api/v2.');
}
if (
  !isIsoDate(checkin) ||
  !isIsoDate(checkout) ||
  checkout <= checkin
) {
  throw new Error('E2E_CHECKIN and E2E_CHECKOUT must be valid ordered YYYY-MM-DD dates.');
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, {
  method = 'GET',
  body,
  apiKey,
  bearerToken,
  idempotencyKey,
  expectedStatus = 200,
} = {}) {
  const headers = {
    Accept: 'application/json',
    'X-Correlation-ID': `e2e-${randomUUID()}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${apiBaseUrl}/${path.replace(/^\/+/, '')}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('json')
    ? await response.json()
    : undefined;

  if (response.status !== expectedStatus) {
    const code = typeof payload?.code === 'string' ? ` (${payload.code})` : '';
    throw new Error(`${method} ${path} returned HTTP ${response.status}${code}; expected ${expectedStatus}.`);
  }
  return { payload, response };
}

function pass(label) {
  console.log(`PASS ${label}`);
}

const health = await request('alojamientos/health');
assert(health.payload?.database?.status === 'CONNECTED', 'Health does not report a connected database.');
assert(
  ['HEALTHY', 'DEGRADED'].includes(health.payload?.status),
  'Health did not report HEALTHY or DEGRADED.',
);
pass('health and Supabase connectivity');

const detail = await request(`alojamientos/${encodeURIComponent(propertyId)}`);
for (const field of [
  'id',
  'nombre',
  'descripcion',
  'destino',
  'estrellas',
  'precioPorNoche',
  'moneda',
  'capacidadAdultos',
  'fotos',
]) {
  assert(Object.hasOwn(detail.payload ?? {}, field), `Property detail is missing '${field}'.`);
}
assert(detail.payload.id === propertyId, 'Property detail returned a different catalog id.');
assert(Array.isArray(detail.payload.fotos), 'Property detail fotos must be an array.');
pass('property detail');

const roomsResult = await request(`alojamientos/${encodeURIComponent(propertyId)}/habitaciones`);
assert(Array.isArray(roomsResult.payload) && roomsResult.payload.length > 0, 'No active room types were returned.');
for (const room of roomsResult.payload) {
  for (const field of [
    'codigo',
    'nombre',
    'cantidad',
    'capacidad_adultos',
    'capacidad_ninos',
    'precio_noche',
    'regimen',
    'cancelacion_gratuita_horas',
  ]) {
    assert(Object.hasOwn(room, field), `Room type is missing '${field}'.`);
  }
}
pass('room types');

const availabilityQuery = new URLSearchParams({
  checkin,
  checkout,
  habitaciones: String(roomCount),
  adultos: String(adults),
  ninos: String(children),
});
const availability = await request(
  `alojamientos/${encodeURIComponent(propertyId)}/availability?${availabilityQuery}`,
);
assert(Array.isArray(availability.payload?.tipos) && availability.payload.tipos.length > 0, 'Availability returned no room types.');
assert(
  Number.isInteger(availability.payload.available_rooms) &&
    availability.payload.available_rooms >= roomCount,
  'Availability does not have enough rooms for this test.',
);
const roomCode = process.env.E2E_ROOM_CODE?.trim();
const availableRoom = availability.payload.tipos.find(
  (room) =>
    (!roomCode || room.codigo === roomCode) &&
    Number.isInteger(room.available_rooms) &&
    room.available_rooms >= roomCount,
);
assert(availableRoom, 'No single room type has enough availability for the requested test.');
pass('positive availability with a reservable room type');

const quoteBody = {
  alojamientoId: propertyId,
  tipoHabitacionCodigo: availableRoom.codigo,
  fechaInicio: checkin,
  fechaFin: checkout,
  cantidadHabitaciones: roomCount,
  ocupantes: { adultos, ninos: children },
  currency: 'USD',
};
const quoteResult = await request('alojamientos/availability', {
  method: 'POST',
  body: quoteBody,
});
assert(quoteResult.payload?.estaDisponible === true, 'Quote did not confirm availability.');
assert(typeof quoteResult.payload?.cotizacionId === 'string', 'Quote did not return cotizacionId.');
assert(
  /^\d+\.\d{2}$/.test(quoteResult.payload?.precioTotalCotizado ?? ''),
  'Quote did not return an exact two-decimal total.',
);
assert(Date.parse(quoteResult.payload.tarifaValidaHasta) > Date.now(), 'Quote is already expired.');
pass('price quote');

const runCustomerSync = process.env.E2E_RUN_CUSTOMER_SYNC === 'true';
const runBooking = process.env.E2E_RUN_BOOKING === 'true';
const runCheckin = process.env.E2E_RUN_CHECKIN === 'true';
const apiKey = process.env.API_KEY?.trim();

if (runCustomerSync) {
  if (!apiKey) throw new Error('API_KEY is required for customer synchronization.');
  const customers = await request('clientes', { apiKey });
  assert(Array.isArray(customers.payload?.data), 'Customer list did not return a data array.');
  const guest = {
    nombreCompleto: 'E2E Guest Test',
    tipoDocumento: 'PASAPORTE',
    identificacion: 'E2ETEST1',
    email: `e2e-${randomUUID()}@example.invalid`,
    telefono: '+593990000000',
    nacionalidad: 'E2E',
  };
  const synchronized = await request('clientes', {
    method: 'POST',
    apiKey,
    body: guest,
  });
  assert(synchronized.payload?.data?.email === guest.email, 'Customer synchronization returned a different email.');
  assert(typeof synchronized.payload?.data?.id === 'string', 'Customer synchronization did not return an id.');
  pass('customer list and synchronization (creates a synthetic test guest record)');
}

if (runBooking) {
  if (process.env.E2E_ALLOW_LIVE_BOOKING !== 'YES') {
    throw new Error('Set E2E_ALLOW_LIVE_BOOKING=YES only after selecting a dedicated test property and dates.');
  }
  if (!apiKey) throw new Error('API_KEY is required to create and cancel an integration test booking.');

  const orderBody = {
    ...quoteBody,
    regimenSeleccionado: availableRoom.regimen,
    cotizacionId: quoteResult.payload.cotizacionId,
    totalPagar: quoteResult.payload.precioTotalCotizado,
    huespedTitular: {
      nombreCompleto: 'E2E Guest Test',
      tipoDocumento: 'PASAPORTE',
      identificacion: 'E2ETEST1',
      email: `e2e-${randomUUID()}@example.invalid`,
      telefono: '+593990000000',
      nacionalidad: 'E2E',
    },
  };
  const createKey = randomUUID();
  const createResult = await request('alojamientos/orders/create', {
    method: 'POST',
    apiKey,
    idempotencyKey: createKey,
    body: orderBody,
    expectedStatus: 201,
  });
  const externalOrderId =
    createResult.payload?.externalOrderId ?? createResult.payload?.external_order_id;
  const orderId = createResult.payload?.orderId;
  assert(
    typeof externalOrderId === 'string' &&
      /^ORD-HTL-[A-Z0-9]{3,20}$/.test(externalOrderId),
    'Created booking did not return a valid externalOrderId.',
  );

  let cancellationKey;
  let cancellationBody;
  let cancelled = false;
  try {
    assert(
      typeof orderId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId),
      'Created booking did not return a valid orderId UUID.',
    );
    const replay = await request('alojamientos/orders/create', {
      method: 'POST',
      apiKey,
      idempotencyKey: createKey,
      body: orderBody,
      expectedStatus: 201,
    });
    assert(replay.response.headers.get('idempotent-replayed') === 'true', 'Create retry was not marked idempotent.');
    assert(
      (replay.payload?.externalOrderId ?? replay.payload?.external_order_id) === externalOrderId,
      'Create retry returned a different externalOrderId.',
    );
    pass('booking creation and idempotent replay');

    cancellationKey = randomUUID();
    cancellationBody = {
      solicitadoPor: 'SAGA_ORCHESTRATOR',
      motivo: 'E2E integration test cleanup',
    };
    const cancellation = await request(
      `alojamientos/orders/${encodeURIComponent(externalOrderId)}/cancel`,
      {
        method: 'POST',
        apiKey,
        idempotencyKey: cancellationKey,
        body: cancellationBody,
      },
    );
    assert(cancellation.payload?.cuposRestaurados === true, 'Cancellation did not restore rooms.');
    cancelled = true;

    const cancellationReplay = await request(
      `alojamientos/orders/${encodeURIComponent(externalOrderId)}/cancel`,
      {
        method: 'POST',
        apiKey,
        idempotencyKey: cancellationKey,
        body: cancellationBody,
      },
    );
    assert(
      cancellationReplay.response.headers.get('idempotent-replayed') === 'true',
      'Cancellation retry was not marked idempotent.',
    );
    pass('booking cancellation, room restoration, and idempotent replay');

    console.log(`OUTBOX_ORDER_ID=${orderId ?? 'not-returned'}`);
    console.log('Verify stock delivery for this order in Supabase using the query documented in README.');
  } finally {
    if (!cancelled) {
      cancellationKey ??= randomUUID();
      cancellationBody ??= {
        solicitadoPor: 'SAGA_ORCHESTRATOR',
        motivo: 'E2E integration test cleanup',
      };
      await request(
        `alojamientos/orders/${encodeURIComponent(externalOrderId)}/cancel`,
        {
          method: 'POST',
          apiKey,
          idempotencyKey: cancellationKey,
          body: cancellationBody,
        },
      );
      console.warn('E2E booking was cancelled during cleanup.');
    }
  }
}

if (runCheckin) {
  const orderId = required('E2E_CHECKIN_ORDER_ID');
  const bearerToken = required('E2E_ADMIN_BEARER_TOKEN');
  const guestCount = positiveInteger(
    process.env.E2E_HUESPEDES_REALES ?? '1',
    'E2E_HUESPEDES_REALES',
  );
  assert(/^ORD-HTL-[A-Z0-9]{3,20}$/.test(orderId), 'E2E_CHECKIN_ORDER_ID has an invalid format.');

  const origin = new URL(apiBaseUrl).origin;
  const checkinPath = `/api/v1/reservas/${encodeURIComponent(orderId)}/checkin`;
  const response = await fetch(`${origin}${checkinPath}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ huespedesReales: guestCount }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = response.headers.get('content-type')?.includes('json')
    ? await response.json()
    : undefined;
  assert(response.status === 200, `Check-in returned HTTP ${response.status}.`);
  assert(
    payload?.data?.estado === 'CONFIRMADO_ASISTIDO',
    'Check-in did not return CONFIRMADO_ASISTIDO.',
  );
  pass('assisted check-in (changes the selected live reservation state)');
}

console.log('E2E smoke checks completed.');
