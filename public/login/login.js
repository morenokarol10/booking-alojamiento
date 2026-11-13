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
          : typeof message === 'string'
            ? message
            : result?.error ||
              `No se pudo ${path === 'register' ? 'crear la cuenta' : 'iniciar sesión'} (HTTP ${response.status}).`,
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
    const isStaff = user.role === 'admin' || user.role === 'empleado';
    if (next.startsWith('/admin/') && !isStaff) {
      window.location.assign('/marketplace/?accessDenied=1');
      return;
    }
    window.location.assign(
      isStaff && next === '/marketplace/' ? '/admin/' : next,
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
// ---- Reglas de cuenta: cédula ecuatoriana y contraseña segura ----
const PASSWORD_RULES = {
  length: (value) => value.length >= 8,
  upper: (value) => /[A-ZÁÉÍÓÚÑ]/.test(value),
  number: (value) => /\d/.test(value),
  special: (value) => /[^A-Za-z0-9\s]/.test(value),
};

function isValidEcuadorianCedula(value) {
  if (!/^[0-9]{10}$/.test(value)) return false;
  const province = Number(value.slice(0, 2));
  if (province < 1 || province > 24 || Number(value[2]) > 5) return false;
  const sum = value
    .slice(0, 9)
    .split('')
    .reduce((total, digit, index) => {
      const weighted = index % 2 === 0 ? Number(digit) * 2 : Number(digit);
      return total + (weighted > 9 ? weighted - 9 : weighted);
    }, 0);
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

const registerPassword = registerForm.elements.password;
const registerCedula = registerForm.elements.cedula;
const cedulaHint = document.querySelector('#register-cedula-hint');

function updatePasswordRules() {
  const value = registerPassword.value;
  let allValid = true;
  for (const item of document.querySelectorAll('#register-password-rules [data-rule]')) {
    const ok = PASSWORD_RULES[item.dataset.rule](value);
    allValid &&= ok;
    item.classList.toggle('ok', ok);
  }
  registerPassword.setCustomValidity(
    allValid
      ? ''
      : 'La contraseña necesita 8 caracteres, una mayúscula, un número y un carácter especial.',
  );
}

function updateCedulaHint() {
  const value = registerCedula.value.trim();
  const valid = isValidEcuadorianCedula(value);
  registerCedula.setCustomValidity(
    value.length === 10 && !valid ? 'La cédula no es válida.' : '',
  );
  cedulaHint.dataset.state = value.length === 10 ? (valid ? 'ok' : 'error') : '';
  cedulaHint.textContent =
    value.length === 10
      ? valid
        ? 'Cédula válida.'
        : 'Esta cédula no es válida: revisa los dígitos.'
      : '10 dígitos. La pide Booking para identificarte.';
}

registerPassword.addEventListener('input', updatePasswordRules);
registerCedula.addEventListener('input', () => {
  registerCedula.value = registerCedula.value.replace(/\D/g, '').slice(0, 10);
  updateCedulaHint();
});
registerForm.addEventListener('reset', () => {
  window.setTimeout(() => {
    updatePasswordRules();
    updateCedulaHint();
  });
});
updatePasswordRules();

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
