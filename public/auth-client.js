(() => {
  const TOKEN_KEY = 'bookingAccessToken';
  const USER_KEY = 'bookingUser';

  function token() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function saveSession(session, user) {
    if (!session?.accessToken || !user) {
      throw new Error(
        'La respuesta de autenticación no contiene una sesión válida.',
      );
    }
    sessionStorage.setItem(TOKEN_KEY, session.accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  async function fetchProfile() {
    const accessToken = token();
    if (!accessToken) return null;
    const response = await fetch('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401) {
      clearSession();
      return null;
    }
    if (!response.ok) {
      throw new Error('No se pudo validar la sesión.');
    }
    const result = await response.json();
    return result.data;
  }

  function goToLogin(next = window.location.pathname) {
    const safeNext =
      next.startsWith('/') && !next.startsWith('//') ? next : '/marketplace/';
    window.location.assign(`/login/?next=${encodeURIComponent(safeNext)}`);
  }

  window.BookingAuth = {
    token,
    saveSession,
    clearSession,
    fetchProfile,
    goToLogin,
  };
})();
