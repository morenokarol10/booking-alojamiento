import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.',
  );
}

const providerId = '20000000-0000-4000-8000-000000000001';
const accommodations = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    proveedor_id: providerId,
    nombre: 'Suite Familiar - Centro Histórico de Quito',
    descripcion:
      'Suite luminosa a pasos de plazas, iglesias y cafés tradicionales del Centro Histórico.',
    tipo: 'hotel',
    ciudad: 'Quito',
    direccion: 'Centro Histórico, Quito, Pichincha, Ecuador',
    latitud: -0.2202,
    longitud: -78.5123,
    precio_base_noche: 85,
    moneda: 'USD',
    capacidad_maxima: 4,
    habitaciones_disponibles: 2,
    servicios: ['WiFi', 'Desayuno incluido', 'Recepción 24 horas'],
    politica_cancelacion: 'Cancelación gratuita hasta 48 horas antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    proveedor_id: providerId,
    nombre: 'Loft Colonial - El Ejido, Cuenca',
    descripcion:
      'Loft independiente cerca del parque El Ejido, galerías y el centro histórico de Cuenca.',
    tipo: 'departamento',
    ciudad: 'Cuenca',
    direccion: 'El Ejido, Cuenca, Azuay, Ecuador',
    latitud: -2.907,
    longitud: -79.0045,
    precio_base_noche: 68,
    moneda: 'USD',
    capacidad_maxima: 3,
    habitaciones_disponibles: 2,
    servicios: ['WiFi', 'Cocina equipada', 'Lavandería'],
    politica_cancelacion: 'Cancelación gratuita hasta 48 horas antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    proveedor_id: providerId,
    nombre: 'Loft Vista al Río - Puerto Santa Ana',
    descripcion:
      'Departamento moderno con vista al río Guayas y acceso a restaurantes del malecón.',
    tipo: 'departamento',
    ciudad: 'Guayaquil',
    direccion: 'Puerto Santa Ana, Guayaquil, Guayas, Ecuador',
    latitud: -2.1809,
    longitud: -79.8776,
    precio_base_noche: 110,
    moneda: 'USD',
    capacidad_maxima: 4,
    habitaciones_disponibles: 2,
    servicios: ['WiFi', 'Piscina', 'Gimnasio', 'Parqueadero'],
    politica_cancelacion: 'Cancelación gratuita hasta 72 horas antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    proveedor_id: providerId,
    nombre: 'Cabaña Aventura - Baños',
    descripcion:
      'Cabaña de montaña con terraza y acceso conveniente a cascadas y actividades de aventura.',
    tipo: 'villa',
    ciudad: 'Baños de Agua Santa',
    direccion: 'Sector San Martín, Baños de Agua Santa, Tungurahua, Ecuador',
    latitud: -1.3964,
    longitud: -78.4247,
    precio_base_noche: 72,
    moneda: 'USD',
    capacidad_maxima: 5,
    habitaciones_disponibles: 2,
    servicios: ['WiFi', 'Terraza', 'Vista a la montaña', 'Parqueadero'],
    politica_cancelacion: 'Cancelación gratuita hasta 72 horas antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    proveedor_id: providerId,
    nombre: 'Hacienda San José - Mindo',
    descripcion:
      'Hacienda rodeada de bosque nublado, ideal para observar aves y descansar junto al jardín.',
    tipo: 'hotel',
    ciudad: 'Mindo',
    direccion: 'Vía a las cascadas, Mindo, Pichincha, Ecuador',
    latitud: -0.0526,
    longitud: -78.7751,
    precio_base_noche: 145,
    moneda: 'USD',
    capacidad_maxima: 4,
    habitaciones_disponibles: 3,
    servicios: ['WiFi', 'Desayuno incluido', 'Jardín', 'Tours de naturaleza'],
    politica_cancelacion: 'Cancelación gratuita hasta 5 días antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    proveedor_id: providerId,
    nombre: 'Casa de Playa - Montañita',
    descripcion:
      'Estancia relajada a pocos minutos caminando de la playa, restaurantes y escuelas de surf.',
    tipo: 'villa',
    ciudad: 'Montañita',
    direccion: 'Barrio El Tigrillo, Montañita, Santa Elena, Ecuador',
    latitud: -1.8262,
    longitud: -80.7525,
    precio_base_noche: 55,
    moneda: 'USD',
    capacidad_maxima: 4,
    habitaciones_disponibles: 2,
    servicios: ['WiFi', 'Cocina equipada', 'Hamacas', 'Ducha exterior'],
    politica_cancelacion: 'Cancelación gratuita hasta 48 horas antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    proveedor_id: providerId,
    nombre: 'Posada Tortuga - Puerto Ayora',
    descripcion:
      'Posada tranquila para descubrir la estación Charles Darwin y las playas de Santa Cruz.',
    tipo: 'hotel',
    ciudad: 'Puerto Ayora',
    direccion: 'Avenida Baltra, Puerto Ayora, Santa Cruz, Galápagos, Ecuador',
    latitud: -0.7401,
    longitud: -90.3138,
    precio_base_noche: 175,
    moneda: 'USD',
    capacidad_maxima: 3,
    habitaciones_disponibles: 2,
    servicios: [
      'WiFi',
      'Desayuno incluido',
      'Aire acondicionado',
      'Excursiones',
    ],
    politica_cancelacion: 'Cancelación gratuita hasta 7 días antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1530789253388-582c481c54b0?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    proveedor_id: providerId,
    nombre: 'Estudio Urbano - La Floresta, Quito',
    descripcion:
      'Estudio práctico en un barrio creativo, cerca de cafeterías, parques y transporte.',
    tipo: 'departamento',
    ciudad: 'Quito',
    direccion: 'La Floresta, Quito, Pichincha, Ecuador',
    latitud: -0.2077,
    longitud: -78.4863,
    precio_base_noche: 42,
    moneda: 'USD',
    capacidad_maxima: 2,
    habitaciones_disponibles: 3,
    servicios: ['WiFi', 'Cocina equipada', 'Espacio de trabajo'],
    politica_cancelacion: 'Cancelación gratuita hasta 24 horas antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000009',
    proveedor_id: providerId,
    nombre: 'Refugio del Río - Baños',
    descripcion:
      'Habitación acogedora con balcón y vistas verdes, a corta distancia del centro de Baños.',
    tipo: 'hotel',
    ciudad: 'Baños de Agua Santa',
    direccion: 'Barrio El Recreo, Baños de Agua Santa, Tungurahua, Ecuador',
    latitud: -1.3973,
    longitud: -78.4189,
    precio_base_noche: 38,
    moneda: 'USD',
    capacidad_maxima: 2,
    habitaciones_disponibles: 4,
    servicios: ['WiFi', 'Desayuno incluido', 'Balcón', 'Agua caliente'],
    politica_cancelacion: 'Cancelación gratuita hasta 48 horas antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=85',
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000010',
    proveedor_id: providerId,
    nombre: 'Casa Jardín del Austro - Cuenca',
    descripcion:
      'Casa amplia con patio interior, cocina completa y ambiente tranquilo para familias.',
    tipo: 'villa',
    ciudad: 'Cuenca',
    direccion: 'El Vergel, Cuenca, Azuay, Ecuador',
    latitud: -2.9108,
    longitud: -79.0005,
    precio_base_noche: 128,
    moneda: 'USD',
    capacidad_maxima: 6,
    habitaciones_disponibles: 1,
    servicios: [
      'WiFi',
      'Cocina equipada',
      'Jardín',
      'Parqueadero',
      'Lavandería',
    ],
    politica_cancelacion: 'Cancelación gratuita hasta 5 días antes.',
    urls_imagenes: [
      'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85',
    ],
  },
];

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const accommodation of accommodations) {
  if (
    !Array.isArray(accommodation.servicios) ||
    !accommodation.servicios.every((service) => typeof service === 'string')
  ) {
    throw new TypeError(
      `Los servicios de ${accommodation.nombre} deben ser un arreglo de texto.`,
    );
  }
}

const { data, error } = await supabase
  .from('alojamientos')
  .upsert(accommodations, { onConflict: 'id' })
  .select('id, nombre, ciudad');

if (error) {
  throw new Error(
    `No se pudieron insertar los alojamientos de prueba: ${error.message}`,
  );
}
if (!Array.isArray(data)) {
  throw new Error('Supabase no devolvió la lista de alojamientos procesados.');
}

console.log(
  `Seed completado: ${data.length} alojamientos insertados/actualizados.`,
);
for (const accommodation of data) {
  console.log(`- ${accommodation.nombre} (${accommodation.ciudad})`);
}
