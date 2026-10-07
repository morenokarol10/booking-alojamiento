import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.',
  );
}

const customers = [
  ['Ana', 'Paredes'],
  ['Mateo', 'Villacís'],
  ['Camila', 'Cevallos'],
  ['Sebastián', 'Mendoza'],
  ['Valentina', 'Quishpe'],
  ['Andrés', 'Molina'],
  ['Daniela', 'Chávez'],
  ['José', 'Guamán'],
  ['Sofía', 'López'],
  ['Martín', 'Jaramillo'],
  ['Isabella', 'Salazar'],
  ['Nicolás', 'Castro'],
  ['María', 'Toapanta'],
  ['Gabriel', 'Vera'],
  ['Lucía', 'Espinoza'],
  ['Emilio', 'Aguirre'],
  ['Paula', 'Sánchez'],
  ['Diego', 'Cárdenas'],
  ['Mía', 'Benítez'],
  ['Joaquín', 'Ortega'],
  ['Doménica', 'Reinoso'],
  ['Felipe', 'Navarro'],
  ['Renata', 'Yánez'],
  ['Tomás', 'Ponce'],
  ['Ariana', 'Mora'],
  ['Juan', 'Cisneros'],
  ['Elena', 'Viteri'],
  ['David', 'Pazmiño'],
  ['Carolina', 'León'],
  ['Samuel', 'Acosta'],
];

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: accommodations, error: accommodationsError } = await supabase
  .from('alojamientos')
  .select('id, precio_base_noche, moneda, capacidad_maxima')
  .order('id');

if (accommodationsError) {
  throw new Error(
    `No se pudieron consultar alojamientos: ${accommodationsError.message}`,
  );
}
if (!accommodations?.length) {
  throw new Error(
    'No hay alojamientos disponibles. Ejecuta primero npm run seed:alojamientos.',
  );
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

const firstCheckin = new Date();
firstCheckin.setUTCHours(0, 0, 0, 0);
firstCheckin.setUTCDate(firstCheckin.getUTCDate() + 30);

const reservations = customers.map(([firstName, lastName], index) => {
  const accommodation = accommodations[index % accommodations.length];
  const nights = 2 + (index % 4);
  const checkin = new Date(firstCheckin);
  checkin.setUTCDate(
    checkin.getUTCDate() + Math.floor(index / accommodations.length) * 6,
  );
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + nights);
  const id = `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  const emailName = `${firstName}.${lastName}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z.]/g, '');

  return {
    id,
    alojamiento_id: accommodation.id,
    cliente_id: null,
    cliente_nombre: `${firstName} ${lastName}`,
    cliente_email: `${emailName}.${String(index + 1).padStart(2, '0')}@example.com`,
    cliente_telefono: null,
    fecha_checkin: formatDate(checkin),
    fecha_checkout: formatDate(checkout),
    num_huespedes: Math.min(
      1 + (index % 4),
      Number(accommodation.capacidad_maxima),
    ),
    precio_total:
      Math.round(Number(accommodation.precio_base_noche) * nights * 100) / 100,
    moneda: accommodation.moneda || 'USD',
    metodo_pago_simulado: index % 2 === 0 ? 'tarjeta' : 'transferencia',
    pago_estado: 'exitoso',
    pago_referencia: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    estado: 'confirmada',
  };
});

const { data, error } = await supabase
  .from('reservas')
  .upsert(reservations, { onConflict: 'id' })
  .select('id, cliente_nombre, cliente_email');

if (error) {
  throw new Error(
    `No se pudieron insertar las reservas de prueba: ${error.message}`,
  );
}
if (!Array.isArray(data) || data.length !== customers.length) {
  throw new Error(
    `Supabase procesó ${data?.length ?? 0} de ${customers.length} reservas de prueba.`,
  );
}

console.log(
  `Seed completado: ${data.length} reservas de prueba creadas o actualizadas.`,
);
console.log(
  'Los clientes son identidades ficticias vinculadas a cliente_id NULL; no se crearon usuarios ni credenciales en Supabase Auth.',
);
