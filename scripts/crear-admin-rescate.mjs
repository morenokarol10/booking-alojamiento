import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const adminEmail = 'admin@booking.ec';
const adminName = 'Administrador Principal';
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const adminPassword = process.env.ADMIN_SEED_PASSWORD;

if (!supabaseUrl || !serviceRoleKey || !adminPassword) {
  throw new Error(
    'Define SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y ADMIN_SEED_PASSWORD en .env.',
  );
}
if (adminPassword.length < 12) {
  throw new Error('ADMIN_SEED_PASSWORD debe tener al menos 12 caracteres.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let existingUser;
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) {
    throw new Error(`No se pudieron consultar usuarios: ${error.message}`);
  }

  existingUser = data.users.find(
    (user) => user.email?.toLowerCase() === adminEmail,
  );
  if (existingUser || data.users.length < 1000) break;
}

const userResult = existingUser
  ? await supabase.auth.admin.updateUserById(existingUser.id, {
      password: adminPassword,
      email_confirm: true,
      app_metadata: { ...existingUser.app_metadata, role: 'admin' },
      user_metadata: {
        ...existingUser.user_metadata,
        role: 'admin',
        nombre: adminName,
      },
    })
  : await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      app_metadata: { role: 'admin' },
      user_metadata: { role: 'admin', nombre: adminName },
    });

if (userResult.error) {
  throw new Error(
    `No se pudo crear o actualizar el administrador: ${userResult.error.message}`,
  );
}

const adminUser = userResult.data.user;
if (!adminUser) {
  throw new Error('Supabase no devolvió el usuario administrador.');
}

for (const table of ['usuarios', 'proveedores']) {
  const { error } = await supabase
    .from(table)
    .upsert({ id: adminUser.id, role: 'admin' }, { onConflict: 'id' });

  if (!error) {
    console.log(`Registro admin sincronizado en public.${table}.`);
    continue;
  }

  if (error.code === 'PGRST205' || error.code === '42P01') {
    console.log(`public.${table} no existe; se omite la sincronización.`);
    continue;
  }

  if (error.code === 'PGRST204' || error.code === '42703') {
    console.warn(
      `public.${table} existe, pero no tiene las columnas id/role requeridas; revisa su esquema.`,
    );
    continue;
  }

  throw new Error(
    `No se pudo sincronizar public.${table}: ${error.message} (${error.code ?? 'sin código'}).`,
  );
}

console.log(
  `Administrador ${adminEmail} listo; id=${adminUser.id}, correo confirmado y rol admin asignado.`,
);
