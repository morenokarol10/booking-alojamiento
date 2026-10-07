const API_BASE = '/api/v1';
const DEFAULT_IMAGES = {
  hotel:
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80',
  departamento:
    'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1000&q=80',
  villa:
    'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1000&q=80',
};
const TYPE_LABELS = {
  hotel: 'Hotel',
  departamento: 'Departamento',
  villa: 'Villa',
};

const grid = document.querySelector('#listing-grid');
const resultCount = document.querySelector('#result-count');
const statusMessage = document.querySelector('#status-message');
const searchForm = document.querySelector('#search-form');
const locationFilter = document.querySelector('#location-filter');
const priceFilter = document.querySelector('#price-filter');
const clearFilters = document.querySelector('#clear-filters');
const detailDialog = document.querySelector('#detail-dialog');
const dialogContent = document.querySelector('#dialog-content');
const successDialog = document.querySelector('#success-dialog');
const successMessage = document.querySelector('#success-message');
const toast = document.querySelector('#toast');
let toastTimeout;
let currentListings = [];
let selectedListing = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function imageFor(listing) {
  return (
    listing.imagenes?.[0] ||
    DEFAULT_IMAGES[listing.tipo] ||
    DEFAULT_IMAGES.hotel
  );
}

function formatMoney(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

async function readResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message;
    throw new Error(
      Array.isArray(message)
        ? message.join(' ')
        : message || `La solicitud falló (${response.status}).`,
    );
  }
  return body;
}

function setLoading() {
  grid.setAttribute('aria-busy', 'true');
  statusMessage.hidden = true;
  grid.innerHTML = Array.from(
    { length: 4 },
    () => '<div class="skeleton" aria-hidden="true"></div>',
  ).join('');
  resultCount.textContent = 'Buscando alojamientos...';
}

function renderListings(listings) {
  currentListings = listings;
  grid.setAttribute('aria-busy', 'false');
  clearFilters.hidden = !locationFilter.value && !priceFilter.value;
  resultCount.textContent = `${listings.length} ${listings.length === 1 ? 'alojamiento disponible' : 'alojamientos disponibles'}`;

  if (!listings.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <strong>No encontramos estancias con esos filtros</strong>
        Prueba con otro destino o amplía tu presupuesto.
      </div>`;
    return;
  }

  grid.innerHTML = listings
    .map(
      (listing, index) => `
        <article class="listing-card" tabindex="0" role="button" data-listing-index="${index}" aria-label="Ver detalles de ${escapeHtml(listing.nombre)}">
          <div class="card-image-wrap">
            <img class="card-image" src="${escapeHtml(imageFor(listing))}" alt="${escapeHtml(listing.nombre)}" loading="${index < 4 ? 'eager' : 'lazy'}" />
            <span class="type-pill">${escapeHtml(TYPE_LABELS[listing.tipo] || listing.tipo)}</span>
            <span class="favorite-mark" aria-hidden="true">♡</span>
          </div>
          <div class="card-info">
            <div class="card-title-line">
              <h3 class="card-title" title="${escapeHtml(listing.nombre)}">${escapeHtml(listing.nombre)}</h3>
              <span class="rating" aria-label="Alojamiento destacado"><span aria-hidden="true">★</span> 4.9</span>
            </div>
            <p class="card-location">${escapeHtml(listing.ciudad)}</p>
            <div class="card-price"><strong>${formatMoney(listing.precioBaseNoche, listing.moneda)}</strong><span>/ noche</span></div>
          </div>
        </article>`,
    )
    .join('');
}

function showError(message) {
  grid.setAttribute('aria-busy', 'false');
  resultCount.textContent = 'No se pudieron cargar los alojamientos';
  grid.innerHTML = `
    <div class="error-state">
      <strong>Hubo un problema al cargar las estancias</strong>
      ${escapeHtml(message)}
      <br /><button class="retry-button" id="retry-button" type="button">Intentar de nuevo</button>
    </div>`;
}

async function loadListings() {
  setLoading();
  const params = new URLSearchParams();
  const location = locationFilter.value.trim();
  const maxPrice = priceFilter.value.trim();
  if (location) params.set('ciudad', location);
  if (maxPrice) params.set('precioMaximo', maxPrice);
  const query = params.size ? `?${params.toString()}` : '';

  try {
    const response = await fetch(`${API_BASE}/alojamientos${query}`);
    const body = await readResponse(response);
    const listings = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(listings)) {
      throw new Error('La API devolvió una respuesta inesperada.');
    }
    statusMessage.hidden = true;
    renderListings(listings);
  } catch (error) {
    showError(error.message || 'Verifica la conexión con el servidor.');
  }
}

function nightsBetween(start, end) {
  if (!start || !end) return 0;
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  return Math.max(0, Math.round((endDate - startDate) / 86400000));
}

function renderDetails(listing) {
  const today = new Date();
  const localToday = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 10);
  dialogContent.innerHTML = `
    <img class="detail-photo" src="${escapeHtml(imageFor(listing))}" alt="${escapeHtml(listing.nombre)}" />
    <div class="detail-body">
      <div class="detail-topline">
        <span class="detail-type">${escapeHtml(TYPE_LABELS[listing.tipo] || listing.tipo)}</span>
        <span class="detail-capacity">${Number(listing.capacidadMaxima)} ${Number(listing.capacidadMaxima) === 1 ? 'huésped' : 'huéspedes'}</span>
      </div>
      <h2 id="detail-title">${escapeHtml(listing.nombre)}</h2>
      <p class="detail-location">${escapeHtml(listing.direccion)}, ${escapeHtml(listing.ciudad)}</p>
      <p class="detail-description">${escapeHtml(listing.descripcion || 'Un espacio acogedor para disfrutar tu próxima escapada.')}</p>
      <p class="detail-description">${escapeHtml(listing.servicios?.join(' · ') || '')}</p>
      <p class="detail-description">${escapeHtml(listing.politicaCancelacion || '')}</p>
      <section class="booking-box" aria-label="Formulario de reserva">
        <div class="booking-header">
          <strong>${formatMoney(listing.precioBaseNoche, listing.moneda)} <span>/ noche</span></strong>
          <span>Sin cargos ocultos</span>
        </div>
        <form class="booking-form" id="booking-form">
          <label class="full-width">Nombre completo
            <input name="clienteNombre" type="text" autocomplete="name" placeholder="Tu nombre" minlength="2" required />
          </label>
          <label class="full-width">Correo electrónico
            <input name="clienteEmail" type="email" autocomplete="email" placeholder="nombre@correo.com" required />
          </label>
          <label class="full-width">Teléfono
            <input name="clienteTelefono" type="tel" autocomplete="tel" placeholder="+593 99 123 4567" minlength="5" required />
          </label>
          <label>Fecha de inicio
            <input name="fechaCheckin" type="date" min="${localToday}" required />
          </label>
          <label>Fecha de fin
            <input name="fechaCheckout" type="date" min="${localToday}" required />
          </label>
          <label>Número de huéspedes
            <input name="numHuespedes" type="number" min="1" max="${Number(listing.capacidadMaxima)}" value="1" required />
          </label>
          <label>Método de pago (simulado)
            <select name="metodoPagoSimulado" required>
              <option value="tarjeta" selected>Tarjeta de prueba</option>
              <option value="transferencia">Transferencia simulada</option>
            </select>
          </label>
          <div class="total-row"><span id="nights-label">Selecciona las fechas</span><strong id="booking-total">${formatMoney(0, listing.moneda)}</strong></div>
          <button class="primary-button" type="submit">Confirmar reserva</button>
        </form>
      </section>
    </div>`;

  const form = dialogContent.querySelector('#booking-form');
  const startInput = form.elements.fechaCheckin;
  const endInput = form.elements.fechaCheckout;
  const totalLabel = dialogContent.querySelector('#booking-total');
  const nightsLabel = dialogContent.querySelector('#nights-label');

  function updateTotal() {
    endInput.min = startInput.value || localToday;
    const nights = nightsBetween(startInput.value, endInput.value);
    totalLabel.textContent = formatMoney(
      nights * Number(listing.precioBaseNoche),
      listing.moneda,
    );
    nightsLabel.textContent = nights
      ? `${nights} ${nights === 1 ? 'noche' : 'noches'}`
      : 'Selecciona las fechas';
    endInput.setCustomValidity(
      endInput.value && startInput.value && nights === 0
        ? 'La fecha de fin debe ser posterior al inicio.'
        : '',
    );
  }

  startInput.addEventListener('change', updateTotal);
  endInput.addEventListener('change', updateTotal);
  form.addEventListener('submit', submitBooking);
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.hidden = true;
  }, 6000);
}

async function submitBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !selectedListing) return;
  if (!window.BookingAuth.token()) {
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.innerHTML =
    '<span class="spinner" aria-hidden="true"></span> Procesando reserva...';
  submitButton.setAttribute('aria-live', 'polite');

  const formData = new FormData(form);
  const payload = {
    alojamientoId: selectedListing.id,
    clienteNombre: formData.get('clienteNombre').toString().trim(),
    clienteEmail: formData.get('clienteEmail').toString().trim(),
    clienteTelefono: formData.get('clienteTelefono').toString().trim(),
    fechaCheckin: formData.get('fechaCheckin').toString(),
    fechaCheckout: formData.get('fechaCheckout').toString(),
    numHuespedes: Number(formData.get('numHuespedes')),
    metodoPagoSimulado: formData.get('metodoPagoSimulado').toString(),
  };

  try {
    const response = await fetch(`${API_BASE}/reservas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.BookingAuth.token()}`,
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) {
      window.BookingAuth.clearSession();
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    const body = await readResponse(response);
    detailDialog.close();
    successMessage.textContent = `Hemos recibido tu solicitud para ${selectedListing.nombre}. ¡Prepárate para disfrutar tu estadía!`;
    successDialog.showModal();
    form.reset();
  } catch (error) {
    showToast(
      error.message || 'No se pudo completar la reserva. Inténtalo de nuevo.',
    );
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
}

async function initializeMarketplace() {
  const adminLink = document.querySelector('#admin-mode-link');
  const accountLink = document.querySelector('#account-link');
  adminLink.hidden = true;
  const token = window.BookingAuth.token();
  if (token) {
    try {
      const user = await window.BookingAuth.fetchProfile();
      if (user) {
        adminLink.hidden = user.role !== 'admin';
      }
      if (user) {
        accountLink.textContent = 'Cerrar sesión';
        accountLink.href = '#';
        accountLink.addEventListener('click', (event) => {
          event.preventDefault();
          window.BookingAuth.clearSession();
          window.location.reload();
        });
      }
    } catch {
      accountLink.textContent = 'Reintentar sesión';
      accountLink.href = '/login/';
    }
  }
  loadListings();
  if (
    new URLSearchParams(window.location.search).get('accessDenied') === 'admin'
  ) {
    showToast(
      'Acceso denegado: Se requieren credenciales de administrador.',
      true,
    );
  }
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadListings();
});

clearFilters.addEventListener('click', () => {
  searchForm.reset();
  loadListings();
});

grid.addEventListener('click', (event) => {
  if (event.target.closest('#retry-button')) {
    loadListings();
    return;
  }
  const card = event.target.closest('[data-listing-index]');
  if (!card) return;
  selectedListing = currentListings[Number(card.dataset.listingIndex)];
  renderDetails(selectedListing);
  detailDialog.showModal();
});

grid.addEventListener('keydown', (event) => {
  if (
    (event.key === 'Enter' || event.key === ' ') &&
    event.target.matches('[data-listing-index]')
  ) {
    event.preventDefault();
    event.target.click();
  }
});

document.querySelectorAll('.dialog-close').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});
document
  .querySelector('.success-done')
  .addEventListener('click', () => successDialog.close());
detailDialog.addEventListener('click', (event) => {
  if (event.target === detailDialog) detailDialog.close();
});
successDialog.addEventListener('click', (event) => {
  if (event.target === successDialog) successDialog.close();
});

void initializeMarketplace();
