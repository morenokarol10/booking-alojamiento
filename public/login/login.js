const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const notice = document.querySelector('#auth-notice');
const loginTab = document.querySelector('#login-tab');
const registerTab = document.querySelector('#register-tab');

function showMode(mode) {
  const isRegister = mode === 'register';
  loginForm.reset();
  registerForm.reset();
  loginForm.hidden = isRegister;
  registerForm.hidden = !isRegister;
  loginTab.classList.toggle('active', !isRegister);
  registerTab.classList.toggle('active', isRegister);
  loginTab.setAttribute('aria-selected', String(!isRegister));
  registerTab.setAttribute('aria-selected', String(isRegister));
  document.querySelector('#auth-title').textContent = isRegister
    ? 'Crea tu cuenta'
    : 'Bienvenido';
  document.querySelector('#auth-description').textContent = isRegister
    ? 'Regístrate para reservar tu próxima estadía.'
    : 'Inicia sesión para continuar con tu viaje.';
  notice.hidden = true;
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
}

async function submitAuth(form, path, successText) {
  const button = form.querySelector('button[type="submit"]');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Procesando…';
  notice.hidden = true;

  try {
    const response = await fetch(`/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const message = result?.message;
      throw new Error(
        Array.isArray(message)
          ? message.join(' ')
          : message || 'No se pudo completar la solicitud.',
      );
    }

    const { user, session } = result.data;
    if (!session) {
      showNotice(
        result.message ||
          (path === 'register'
            ? 'Revisa tu correo y confirma la cuenta antes de iniciar sesión.'
            : 'No se inició sesión. Verifica tus credenciales.'),
      );
      return;
    }

    window.BookingAuth.saveSession(session, user);
    if (path === 'register') {
      showNotice(successText);
    }
    const requestedNext = new URLSearchParams(window.location.search).get(
      'next',
    );
    const next =
      requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
        ? requestedNext
        : '/marketplace/';
    if (next.startsWith('/admin/') && user.role !== 'admin') {
      window.location.assign('/marketplace/?accessDenied=1');
      return;
    }
    window.location.assign(
      user.role === 'admin' && next === '/marketplace/' ? '/admin/' : next,
    );
  } catch (error) {
    showNotice(error.message || 'No se pudo conectar con el servidor.', true);
  } finally {
    form.reset();
    button.disabled = false;
    button.textContent = originalText;
  }
}

loginTab.addEventListener('click', () => showMode('login'));
registerTab.addEventListener('click', () => showMode('register'));
loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (loginForm.reportValidity()) void submitAuth(loginForm, 'login');
});
registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (registerForm.reportValidity()) {
    void submitAuth(registerForm, 'register', 'Cuenta cliente creada.');
  }
});

if (new URLSearchParams(window.location.search).get('mode') === 'register') {
  showMode('register');
}

if (new URLSearchParams(window.location.search).get('accessDenied') === '1') {
  showNotice(
    'Acceso denegado: esta cuenta no tiene rol de administrador.',
    true,
  );
}
