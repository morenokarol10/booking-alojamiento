import { createClient } from '@supabase/supabase-js';

const adminEmail = 'admin@booking.ec';
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
  if (error)
    throw new Error(`No se pudieron consultar usuarios: ${error.message}`);
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
    })
  : await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      app_metadata: { role: 'admin' },
    });

if (userResult.error) {
  throw new Error(
    `No se pudo asegurar el usuario administrador: ${userResult.error.message}`,
  );
}

console.log(`Usuario administrador ${adminEmail} listo con rol admin.`);
