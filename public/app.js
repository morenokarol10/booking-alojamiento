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
const myBookingsDialog = document.querySelector('#my-bookings-dialog');
const profileDialog = document.querySelector('#profile-dialog');
const myBookingsList = document.querySelector('#my-bookings-list');
const myBookingsStatus = document.querySelector('#my-bookings-status');
const profileForm = document.querySelector('#profile-form');
const profileStatus = document.querySelector('#profile-status');
const favoritesDialog = document.querySelector('#favorites-dialog');
const favoritesList = document.querySelector('#favorites-list');
const favoritesStatus = document.querySelector('#favorites-status');
const cancelBookingDialog = document.querySelector('#cancel-booking-dialog');
const cancelBookingForm = document.querySelector('#cancel-booking-form');
const cancelBookingStatus = document.querySelector('#cancel-booking-status');
const toast = document.querySelector('#toast');
let toastTimeout;
let currentListings = [];
let selectedListing = null;
let pendingBookingListing = null;
let selectedBookingForCancellation = null;
let favoriteIds = new Set();
let currentUser = null;

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
    const message = body?.message ?? body?.detail ?? body?.error;
    const databaseDetails =
      typeof body?.error === 'string' &&
      typeof message === 'string' &&
      message === 'No se pudo registrar la reserva.'
        ? ` ${body.error}`
        : '';
    throw new Error(
      Array.isArray(message)
        ? message.join(' ')
        : `${message || `La solicitud falló (${response.status}).`}${databaseDetails}`,
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
        <article class="listing-card" tabindex="0" data-listing-index="${index}" aria-label="Ver detalles de ${escapeHtml(listing.nombre)}">
          <div class="card-image-wrap">
            <img class="card-image" src="${escapeHtml(imageFor(listing))}" alt="${escapeHtml(listing.nombre)}" loading="${index < 4 ? 'eager' : 'lazy'}" />
            <span class="type-pill">${escapeHtml(TYPE_LABELS[listing.tipo] || listing.tipo)}</span>
            ${currentUser?.role === 'cliente' ? `<button class="favorite-mark${favoriteIds.has(listing.id) ? ' is-favorite' : ''}" type="button" data-favorite-id="${escapeHtml(listing.id)}" aria-label="${favoriteIds.has(listing.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-pressed="${favoriteIds.has(listing.id)}">♥</button>` : ''}
          </div>
          <div class="card-info">
            <div class="card-title-line">
              <h3 class="card-title" title="${escapeHtml(listing.nombre)}">${escapeHtml(listing.nombre)}</h3>
              <span class="rating" aria-label="Alojamiento destacado"><span aria-hidden="true">★</span> 4.9</span>
            </div>
            <p class="card-location">${escapeHtml(listing.ciudad)}</p>
            ${cardRoomsSummary(listing)}
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

function isFutureMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const [year, month] = value.split('-').map(Number);
  const now = new Date();
  return (
    year > now.getFullYear() ||
    (year === now.getFullYear() && month >= now.getMonth() + 1)
  );
}

function cardRoomsSummary(listing) {
  const rooms = (listing.tiposHabitacion || []).filter((room) => room.cantidad > 0);
  if (!rooms.length) return '';
  const total = rooms.reduce((sum, room) => sum + room.cantidad, 0);
  return `<p class="card-rooms">${total} ${total === 1 ? 'habitación' : 'habitaciones'} · ${rooms.length} ${rooms.length === 1 ? 'tipo' : 'tipos'}</p>`;
}

function renderDetails(listing) {
  const roomTypes = listing.roomTypes || [];
  const firstRoom = roomTypes[0];
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
      <section class="rooms-overview" aria-labelledby="rooms-overview-title">
        <div class="rooms-overview-head">
          <h3 id="rooms-overview-title">Habitaciones</h3>
          <span>${roomTypes.reduce((sum, room) => sum + Number(room.cantidad || 0), 0)} habitaciones en ${roomTypes.length} ${roomTypes.length === 1 ? 'tipo' : 'tipos'}</span>
        </div>
        <div class="rooms-table-wrap">
          <table class="rooms-table">
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Camas por habitación</th>
                <th scope="col">Huéspedes</th>
                <th scope="col">Habitaciones</th>
                <th scope="col">Libres en tus fechas</th>
                <th scope="col">Precio / noche</th>
                <th scope="col"><span class="visually-hidden">Elegir</span></th>
              </tr>
            </thead>
            <tbody>
              ${roomTypes
                .map(
                  (room) => `
                <tr data-room-code="${escapeHtml(room.codigo)}">
                  <th scope="row">${escapeHtml(room.nombre)}${room.descripcion ? `<small>${escapeHtml(room.descripcion)}</small>` : ''}</th>
                  <td>${escapeHtml(room.descripcion_camas || `${Number(room.camas) || 1} cama(s)`)}</td>
                  <td>hasta ${Number(room.capacidad_adultos)}</td>
                  <td>${Number(room.cantidad)}</td>
                  <td class="room-free" data-free>Elige fechas</td>
                  <td>${formatMoney(Number(room.precio_noche), listing.moneda)}</td>
                  <td><button type="button" class="room-pick" data-pick-room="${escapeHtml(room.codigo)}" aria-label="Elegir ${escapeHtml(room.nombre)}">Elegir</button></td>
                </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
      <section class="booking-box" aria-label="Formulario de reserva">
        <div class="booking-header">
          <strong id="booking-total">${formatMoney(0, listing.moneda)}</strong>
          <span>Total final, sujeto a disponibilidad</span>
        </div>
        <form class="booking-form" id="booking-form">
          <label>Habitaciones
            <input name="cantidadHabitaciones" type="number" min="1" max="10" value="1" required />
          </label>
          <label>Camas por habitación
            <select name="camasMinimas">
              <option value="0">Cualquier cantidad</option>
              ${[...new Set(roomTypes.map((room) => Number(room.numero_camas) || 1))]
                .sort((left, right) => left - right)
                .map(
                  (beds) =>
                    `<option value="${beds}">${beds === 1 ? '1 cama o más' : `${beds} camas o más`}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="full-width">Tipo de habitación
            <select name="tipoHabitacionCodigo" required></select>
          </label>
          <p id="room-info" class="room-info full-width" aria-live="polite"></p>
          <section id="occupancy" class="occupancy full-width" aria-labelledby="occupancy-title">
            <div class="occupancy-head">
              <h3 id="occupancy-title">Disponibilidad por noche</h3>
              <div class="occupancy-nav">
                <button type="button" class="occupancy-shift" data-shift="-1" aria-label="Ver semanas anteriores">‹</button>
                <span id="occupancy-range" aria-live="polite"></span>
                <button type="button" class="occupancy-shift" data-shift="1" aria-label="Ver semanas siguientes">›</button>
              </div>
            </div>
            <p class="occupancy-hint">Elige la noche de llegada y luego el día de salida. Las noches <strong>Completas</strong> ya están reservadas, incluidas las reservas hechas desde Booking.</p>
            <div class="occupancy-weekdays" aria-hidden="true"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
            <div class="occupancy-grid"></div>
            <p id="occupancy-status" class="occupancy-status" role="status" aria-live="polite"></p>
            <ul class="occupancy-legend" aria-label="Leyenda">
              <li><span class="legend-swatch is-free" aria-hidden="true"></span>Disponible</li>
              <li><span class="legend-swatch is-low" aria-hidden="true"></span>Últimas habitaciones</li>
              <li><span class="legend-swatch is-full" aria-hidden="true"></span>Completo</li>
              <li><span class="legend-swatch is-selected" aria-hidden="true"></span>Tu estancia</li>
            </ul>
          </section>
          <label>Llegada (check-in desde 14:00)
            <input name="fechaCheckin" type="date" min="${localToday}" required />
          </label>
          <label>Salida (check-out hasta 11:00)
            <input name="fechaCheckout" type="date" min="${localToday}" required />
          </label>
          <label class="full-width">Número de huéspedes
            <input name="numHuespedes" type="number" min="1" max="${Number(firstRoom.capacidad_adultos)}" value="1" required />
          </label>
          <p id="availability-message" class="availability-message full-width" data-state="info" role="status" aria-live="polite">Selecciona fechas para consultar el inventario compartido.</p>
          <section class="booking-customer full-width" aria-label="Datos de tu cuenta">
            <h3>Reserva a nombre de</h3>
            <div class="booking-user-fields">
              <label>Nombre completo
                <input type="text" value="${escapeHtml(currentUser.fullName)}" autocomplete="name" readonly />
              </label>
              <label>Correo electrónico
                <input type="email" value="${escapeHtml(currentUser.email)}" autocomplete="email" readonly />
              </label>
              <label>Teléfono
                <input type="tel" value="${escapeHtml(currentUser.phone)}" autocomplete="tel" readonly />
              </label>
            </div>
            <p>Estos datos se tomarán de tu perfil autenticado.</p>
          </section>
          <fieldset class="payment-demo">
            <legend>Pago con tarjeta (simulación)</legend>
            <p>Usa exclusivamente la tarjeta de prueba 4242 4242 4242 4242. El número completo y el CVV nunca se envían ni se guardan.</p>
            ${
              currentUser?.savedPaymentMethod
                ? `<label><input name="paymentSource" type="radio" value="saved" /> Usar referencia guardada: ${escapeHtml(currentUser.savedPaymentMethod.brand)} •••• ${escapeHtml(currentUser.savedPaymentMethod.lastFour)} <small>(solo simulación; no es una tarjeta reutilizable para cargos)</small></label>`
                : ''
            }
            <label><input name="paymentSource" type="radio" value="new" checked /> Validar tarjeta sandbox</label>
            <div class="payment-card-fields">
              <label>Número de tarjeta de prueba
                <input id="sandbox-card-number" type="tel" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" required />
              </label>
              <label>Vencimiento
                <input id="sandbox-card-expiry" type="month" autocomplete="off" required />
              </label>
              <label>CVV de prueba
                <input id="sandbox-card-cvv" type="password" inputmode="numeric" autocomplete="off" maxlength="3" placeholder="123" required />
              </label>
              <label><input name="saveCard" type="checkbox" /> Guardar referencia enmascarada para futuras simulaciones</label>
            </div>
          </fieldset>
          <div class="total-row"><span id="nights-label">Selecciona las fechas</span><strong id="booking-nights-total">${formatMoney(0, listing.moneda)}</strong></div>
          <button class="primary-button" type="submit" disabled>Confirmar reserva</button>
        </form>
      </section>
    </div>`;

  const form = dialogContent.querySelector('#booking-form');
  const startInput = form.elements.fechaCheckin;
  const endInput = form.elements.fechaCheckout;
  const totalLabel = dialogContent.querySelector('#booking-total');
  const nightsTotal = dialogContent.querySelector('#booking-nights-total');
  const nightsLabel = dialogContent.querySelector('#nights-label');
  const availabilityMessage = dialogContent.querySelector('#availability-message');
  const roomInput = form.elements.tipoHabitacionCodigo;
  const roomCountInput = form.elements.cantidadHabitaciones;
  const guestsInput = form.elements.numHuespedes;
  const submitButton = form.querySelector('button[type="submit"]');
  let quoteRequestNumber = 0;
  const bedsInput = form.elements.camasMinimas;
  const roomsTable = dialogContent.querySelector('.rooms-table');
  let roomsTableRequest = 0;

  async function refreshRoomsTable(start, end) {
    const request = ++roomsTableRequest;
    const cells = roomsTable.querySelectorAll('[data-free]');
    cells.forEach((cell) => {
      cell.textContent = 'Consultando…';
      cell.dataset.state = 'loading';
    });
    try {
      const params = new URLSearchParams({
        checkin: start,
        checkout: end,
        habitaciones: '1',
        adultos: '1',
      });
      const response = await fetch(
        `/api/v2/alojamientos/${encodeURIComponent(listing.codigoIntegracion)}/availability?${params.toString()}`,
      );
      const body = await readResponse(response);
      if (request !== roomsTableRequest) return;
      const byCode = new Map(
        (body.tipos || []).map((room) => [room.codigo, room]),
      );
      for (const row of roomsTable.querySelectorAll('tr[data-room-code]')) {
        const cell = row.querySelector('[data-free]');
        const room = byCode.get(row.dataset.roomCode);
        const free = room ? Number(room.available_rooms) : 0;
        const total = room ? Number(room.total_rooms) : Number(row.children[3].textContent);
        cell.dataset.state = free === 0 ? 'full' : free <= 2 ? 'low' : 'free';
        cell.textContent = free === 0 ? 'Completo' : `${free} de ${total}`;
      }
    } catch {
      if (request !== roomsTableRequest) return;
      cells.forEach((cell) => {
        cell.textContent = '—';
        cell.dataset.state = '';
      });
    }
  }

  roomsTable.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-pick-room]');
    if (!pick) return;
    bedsInput.value = '0';
    renderRoomOptions();
    roomInput.value = pick.dataset.pickRoom;
    roomInput.dispatchEvent(new Event('change'));
    roomInput.focus();
  });
  const roomInfo = dialogContent.querySelector('#room-info');

  function roomOptionLabel(room) {
    const guests = Number(room.capacidad_adultos);
    return `${room.nombre} · ${room.descripcion_camas} · hasta ${guests} ${guests === 1 ? 'huésped' : 'huéspedes'} · ${formatMoney(Number(room.precio_noche), listing.moneda)}/noche`;
  }

  function renderRoomInfo() {
    const room = roomTypes.find((item) => item.codigo === roomInput.value);
    if (!room) {
      roomInfo.textContent = 'No hay habitaciones con esa cantidad de camas.';
      return;
    }
    const guests = Number(room.capacidad_adultos);
    roomInfo.innerHTML = `<strong>${escapeHtml(room.nombre)}</strong>: ${escapeHtml(room.descripcion_camas)}, hasta ${guests} ${guests === 1 ? 'huésped' : 'huéspedes'} por habitación. ${escapeHtml(room.descripcion || '')}`;
  }

  function renderRoomOptions() {
    const minimumBeds = Number(bedsInput.value) || 0;
    const previous = roomInput.value;
    const visibleRooms = roomTypes.filter(
      (room) => (Number(room.numero_camas) || 1) >= minimumBeds,
    );
    roomInput.replaceChildren(
      ...visibleRooms.map((room) => {
        const option = document.createElement('option');
        option.value = room.codigo;
        option.textContent = roomOptionLabel(room);
        return option;
      }),
    );
    if (visibleRooms.some((room) => room.codigo === previous)) {
      roomInput.value = previous;
    }
    renderRoomInfo();
    return roomInput.value !== previous;
  }
  renderRoomOptions();

  function setAvailability(state, text) {
    availabilityMessage.dataset.state = state;
    availabilityMessage.textContent = text;
  }

  // ---- Calendario de ocupación (inventario compartido sitio + Booking) ----
  const CALENDAR_DAYS = 28;
  const CALENDAR_MAX_PAGE = 3;
  const calendar = dialogContent.querySelector('#occupancy');
  const calendarGrid = calendar.querySelector('.occupancy-grid');
  const calendarRange = calendar.querySelector('#occupancy-range');
  const calendarStatus = calendar.querySelector('#occupancy-status');
  const [previousPage, nextPage] = calendar.querySelectorAll('.occupancy-shift');
  const longDay = new Intl.DateTimeFormat('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const shortDay = new Intl.DateTimeFormat('es-EC', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  let calendarPage = 0;
  let calendarRequest = 0;
  let calendarNights = new Map();

  const isoToDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const addDaysIso = (iso, days) => {
    const date = isoToDate(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const calendarStart = () => addDaysIso(localToday, calendarPage * CALENDAR_DAYS);

  function nightState(date) {
    const night = calendarNights.get(date);
    if (!night) return 'unknown';
    const needed = Math.max(1, Number(roomCountInput.value) || 1);
    if (night.habitaciones_disponibles < needed) return 'full';
    if (night.habitaciones_disponibles <= 2) return 'low';
    return 'free';
  }

  function blockedNights(start, end) {
    const blocked = [];
    for (let date = start; date < end; date = addDaysIso(date, 1)) {
      if (nightState(date) === 'full') blocked.push(date);
    }
    return blocked;
  }

  function renderCalendar() {
    const first = calendarStart();
    const last = addDaysIso(first, CALENDAR_DAYS - 1);
    calendarRange.textContent = `${shortDay.format(isoToDate(first))} – ${shortDay.format(isoToDate(last))}`;
    previousPage.disabled = calendarPage === 0;
    nextPage.disabled = calendarPage >= CALENDAR_MAX_PAGE;
    const start = startInput.value;
    const end = endInput.value;
    const choosingCheckout = Boolean(start) && !end;
    const leadingBlanks = (isoToDate(first).getUTCDay() + 6) % 7;
    const cells = [];
    for (let index = 0; index < leadingBlanks; index += 1) {
      const blank = document.createElement('span');
      blank.className = 'occupancy-blank';
      blank.setAttribute('aria-hidden', 'true');
      cells.push(blank);
    }
    for (let index = 0; index < CALENDAR_DAYS; index += 1) {
      const date = addDaysIso(first, index);
      const night = calendarNights.get(date);
      const state = nightState(date);
      const nightsFromStart = start ? nightsBetween(start, date) : 0;
      const validCheckout =
        choosingCheckout &&
        date > start &&
        nightsFromStart <= 30 &&
        blockedNights(start, date).length === 0;
      const validCheckin = state === 'free' || state === 'low';
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.date = date;
      button.className = `occupancy-day is-${state}`;
      if (start && end && date >= start && date < end) {
        button.classList.add('in-stay');
      }
      if (date === start) button.classList.add('is-start');
      if (date === end) button.classList.add('is-end');
      button.setAttribute('aria-pressed', String(date === start || date === end));
      button.disabled = !(validCheckout || validCheckin);
      const availabilityText = !night
        ? 'sin datos'
        : state === 'full'
          ? 'completo'
          : `${night.habitaciones_disponibles} de ${night.habitaciones_totales} libres`;
      button.setAttribute(
        'aria-label',
        `${longDay.format(isoToDate(date))}: ${availabilityText}${validCheckout ? '. Elegir como salida' : ''}`,
      );
      button.innerHTML = `<span class="day-number">${isoToDate(date).getUTCDate()}</span><span class="day-info">${
        !night ? '–' : state === 'full' ? 'Lleno' : night.habitaciones_disponibles
      }</span>`;
      cells.push(button);
    }
    const focusedDate = calendarGrid.contains(document.activeElement)
      ? document.activeElement.dataset.date
      : undefined;
    calendarGrid.replaceChildren(...cells);
    if (focusedDate) {
      const target = calendarGrid.querySelector(`[data-date="${focusedDate}"]`);
      if (target && !target.disabled) target.focus();
    }
  }

  async function loadCalendar() {
    const request = ++calendarRequest;
    calendar.setAttribute('aria-busy', 'true');
    calendarStatus.textContent = 'Cargando ocupación…';
    try {
      const params = new URLSearchParams({
        desde: calendarStart(),
        dias: String(CALENDAR_DAYS),
        tipoHabitacion: roomInput.value,
      });
      const response = await fetch(
        `/api/v2/alojamientos/${encodeURIComponent(listing.codigoIntegracion)}/calendario?${params.toString()}`,
        { cache: 'no-store' },
      );
      const body = await readResponse(response);
      if (request !== calendarRequest) return;
      for (const night of body.noches ?? []) {
        calendarNights.set(night.fecha, night);
      }
      calendarStatus.textContent = '';
    } catch {
      if (request !== calendarRequest) return;
      calendarStatus.textContent =
        'No se pudo cargar la ocupación. Igual comprobaremos la disponibilidad al elegir las fechas.';
    } finally {
      if (request === calendarRequest) {
        calendar.removeAttribute('aria-busy');
        renderCalendar();
      }
    }
  }

  calendar.addEventListener('click', (event) => {
    const shift = event.target.closest('.occupancy-shift');
    if (shift) {
      calendarPage = Math.min(
        CALENDAR_MAX_PAGE,
        Math.max(0, calendarPage + Number(shift.dataset.shift)),
      );
      void loadCalendar();
      return;
    }
    const day = event.target.closest('.occupancy-day');
    if (!day || day.disabled) return;
    const date = day.dataset.date;
    const start = startInput.value;
    if (
      start &&
      !endInput.value &&
      date > start &&
      nightsBetween(start, date) <= 30 &&
      blockedNights(start, date).length === 0
    ) {
      endInput.value = date;
    } else {
      startInput.value = date;
      endInput.value = '';
    }
    void updateAvailabilityQuote();
  });

  const paymentSourceInputs = form.querySelectorAll(
    'input[name="paymentSource"]',
  );
  const paymentCardFields = form.querySelector('.payment-card-fields');
  const paymentCardInputs = [
    form.querySelector('#sandbox-card-number'),
    form.querySelector('#sandbox-card-expiry'),
    form.querySelector('#sandbox-card-cvv'),
  ];
  function updatePaymentFields() {
    const useSaved = form.elements.paymentSource.value === 'saved';
    paymentCardFields.hidden = useSaved;
    paymentCardInputs.forEach((input) => {
      input.required = !useSaved;
    });
  }
  paymentSourceInputs.forEach((input) =>
    input.addEventListener('change', updatePaymentFields),
  );
  updatePaymentFields();

  async function updateAvailabilityQuote() {
    endInput.min = startInput.value || localToday;
    const nights = nightsBetween(startInput.value, endInput.value);
    totalLabel.textContent = formatMoney(0, listing.moneda);
    nightsTotal.textContent = formatMoney(0, listing.moneda);
    nightsLabel.textContent = nights
      ? `${nights} ${nights === 1 ? 'noche' : 'noches'}`
      : 'Selecciona las fechas';
    endInput.setCustomValidity(
      endInput.value && startInput.value && nights === 0
        ? 'La fecha de fin debe ser posterior al inicio.'
        : '',
    );
    const requestNumber = ++quoteRequestNumber;
    form.dataset.cotizacionId = '';
    form.dataset.quoteFingerprint = '';
    submitButton.disabled = true;
    renderCalendar();
    if (startInput.value && !endInput.value) {
      setAvailability(
        'info',
        `Llegada: ${formatDate(startInput.value)}. Ahora elige el día de salida.`,
      );
      return;
    }
    if (!startInput.value || !endInput.value || nights < 1 || nights > 30) {
      setAvailability(
        nights > 30 || (startInput.value && endInput.value) ? 'error' : 'info',
        nights > 30
          ? 'La estancia máxima permitida es de 30 noches.'
          : startInput.value && endInput.value
            ? 'La fecha de salida debe ser posterior a la de llegada.'
            : 'Selecciona fechas para consultar el inventario compartido.',
      );
      return;
    }
    const blocked = blockedNights(startInput.value, endInput.value);
    if (blocked.length > 0) {
      const listed = blocked
        .slice(0, 4)
        .map((date) => shortDay.format(isoToDate(date)))
        .join(', ');
      setAvailability(
        'error',
        `No disponible: ${blocked.length === 1 ? 'la noche del' : 'las noches del'} ${listed}${blocked.length > 4 ? '…' : ''} ya ${blocked.length === 1 ? 'está reservada' : 'están reservadas'}. Elige otras fechas en el calendario.`,
      );
      return;
    }

    const quoteInput = {
      alojamientoId: listing.codigoIntegracion,
      tipoHabitacionCodigo: roomInput.value,
      fechaInicio: startInput.value,
      fechaFin: endInput.value,
      cantidadHabitaciones: Number(roomCountInput.value),
      ocupantes: {
        adultos: Number(guestsInput.value),
        ninos: 0,
      },
    };
    const selectedRoomType = roomTypes.find(
      (room) => room.codigo === quoteInput.tipoHabitacionCodigo,
    );
    const maxGuests =
      Number(selectedRoomType?.capacidad_adultos ?? 0) *
      quoteInput.cantidadHabitaciones;
    guestsInput.max = String(maxGuests);
    if (quoteInput.ocupantes.adultos > maxGuests) {
      setAvailability(
        'error',
        `Este tipo de habitación admite hasta ${maxGuests} ${maxGuests === 1 ? 'huésped' : 'huéspedes'} con la cantidad seleccionada. Aumenta las habitaciones o reduce los huéspedes.`,
      );
      return;
    }
    void refreshRoomsTable(quoteInput.fechaInicio, quoteInput.fechaFin);
    const fingerprint = JSON.stringify(quoteInput);
    setAvailability('loading', 'Consultando disponibilidad y precio actualizados…');
    try {
      const availabilityParams = new URLSearchParams({
        checkin: quoteInput.fechaInicio,
        checkout: quoteInput.fechaFin,
        habitaciones: String(quoteInput.cantidadHabitaciones),
        adultos: String(quoteInput.ocupantes.adultos),
        tipoHabitacion: quoteInput.tipoHabitacionCodigo,
      });
      const availabilityResponse = await fetch(
        `/api/v2/alojamientos/${encodeURIComponent(listing.codigoIntegracion)}/availability?${availabilityParams.toString()}`,
      );
      const availability = await readResponse(availabilityResponse);
      const selectedRoom = availability.tipos?.find(
        (room) => room.codigo === quoteInput.tipoHabitacionCodigo,
      );
      if (
        !selectedRoom ||
        Number(selectedRoom.available_rooms) < quoteInput.cantidadHabitaciones
      ) {
        throw new Error(
          'No hay suficientes habitaciones de ese tipo para las fechas elegidas.',
        );
      }

      const quoteResponse = await fetch('/api/v2/alojamientos/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quoteInput),
      });
      const quote = await readResponse(quoteResponse);
      if (requestNumber !== quoteRequestNumber) return;
      const quotedTotal = Number(quote.precioTotalCotizado);
      if (
        !quote.cotizacionId ||
        !Number.isFinite(quotedTotal) ||
        quotedTotal < 0
      ) {
        throw new Error('No se recibió una cotización válida del servidor.');
      }
      form.dataset.cotizacionId = quote.cotizacionId;
      form.dataset.quoteFingerprint = fingerprint;
      totalLabel.textContent = formatMoney(quotedTotal, quote.currency);
      nightsTotal.textContent = formatMoney(quotedTotal, quote.currency);
      setAvailability(
        'success',
        `Disponible: ${selectedRoom.nombre}, ${selectedRoom.available_rooms} ${Number(selectedRoom.available_rooms) === 1 ? 'habitación libre' : 'habitaciones libres'}. Precio garantizado hasta las ${new Date(quote.tarifaValidaHasta).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}.`,
      );
      submitButton.disabled = false;
    } catch (error) {
      if (requestNumber !== quoteRequestNumber) return;
      setAvailability(
        'error',
        error.message || 'No se pudo validar la disponibilidad.',
      );
      void loadCalendar();
    }
  }

  [startInput, endInput, roomCountInput, guestsInput].forEach((input) =>
    input.addEventListener('change', updateAvailabilityQuote),
  );
  function onRoomTypeChanged() {
    renderRoomInfo();
    calendarNights = new Map();
    void loadCalendar();
    void updateAvailabilityQuote();
  }
  roomInput.addEventListener('change', onRoomTypeChanged);
  bedsInput.addEventListener('change', () => {
    if (renderRoomOptions()) onRoomTypeChanged();
  });
  form.addEventListener('booking-failed', () => {
    calendarNights = new Map();
    void loadCalendar().then(updateAvailabilityQuote);
  });
  form.addEventListener('submit', submitBooking);
  void loadCalendar();
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.hidden = true;
  }, 6000);
}

function formatDate(value) {
  if (!value) return 'Fecha no disponible';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' }).format(date);
}

async function loadMyBookings() {
  const token = window.BookingAuth.token();
  if (!token) {
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }

  myBookingsStatus.textContent = 'Cargando tus reservas…';
  myBookingsList.replaceChildren();
  try {
    const user = await window.BookingAuth.fetchProfile();
    if (!user) {
      myBookingsDialog.close();
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    const response = await fetch(`${API_BASE}/reservas/mis-reservas`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      window.BookingAuth.clearSession();
      myBookingsDialog.close();
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    const body = await readResponse(response);
    const bookings = Array.isArray(body?.data) ? body.data : null;
    if (!bookings) {
      throw new Error('La API devolvió una lista de reservas no válida.');
    }
    if (!bookings.length) {
      myBookingsStatus.textContent =
        'Aún no tienes reservas. Explora el catálogo para planificar tu viaje.';
      return;
    }

    myBookingsStatus.textContent = `${bookings.length} ${
      bookings.length === 1 ? 'reserva' : 'reservas'
    }`;
    myBookingsList.innerHTML = bookings
      .map((booking) => {
        const accommodation = booking.alojamiento?.nombre || 'Alojamiento';
        const location = booking.alojamiento?.ciudad || '';
        const currency = booking.moneda || 'USD';
        const status = booking.estado || 'pendiente';
        const canCancel =
          status === 'confirmada' &&
          booking.fechaCheckin > new Date().toISOString().slice(0, 10);
        return `
          <article class="my-booking-card">
            <div class="my-booking-heading">
              <div>
                <h3>${escapeHtml(accommodation)}</h3>
                <p>${escapeHtml(location)}</p>
              </div>
              <span class="my-booking-status status-${escapeHtml(status)}">${escapeHtml(status)}</span>
            </div>
            <p class="my-booking-dates">${formatDate(booking.fechaCheckin)} – ${formatDate(booking.fechaCheckout)}</p>
            <strong>${formatMoney(booking.precioTotal, currency)}</strong>
            ${
              canCancel
                ? `<button class="secondary-button cancel-booking-button" type="button" data-cancel-booking-id="${escapeHtml(booking.id)}">Cancelar reserva</button>`
                : ''
            }
          </article>`;
      })
      .join('');
  } catch (error) {
    myBookingsStatus.textContent =
      error.message || 'No se pudieron cargar tus reservas.';
  }
}

async function loadMyProfile() {
  profileStatus.textContent = 'Cargando tu perfil…';
  try {
    const user = await window.BookingAuth.fetchProfile();
    if (!user) {
      profileDialog.close();
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    profileForm.elements.fullName.value = user.fullName || '';
    profileForm.elements.email.value = user.email || '';
    profileForm.elements.phone.value = user.phone || '';
    profileForm.elements.cedula.value = user.cedula || '';
    profileStatus.textContent = '';
  } catch (error) {
    profileStatus.textContent =
      error.message || 'No se pudo cargar tu perfil.';
  }
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!profileForm.reportValidity()) return;
  const button = profileForm.querySelector('button[type="submit"]');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Guardando…';
  profileStatus.textContent = '';
  try {
    const result = await fetch(`${API_BASE}/auth/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.BookingAuth.token()}`,
      },
      body: JSON.stringify(Object.fromEntries(new FormData(profileForm))),
    });
    if (result.status === 401) {
      window.BookingAuth.clearSession();
      profileDialog.close();
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    const body = await readResponse(result);
    window.BookingAuth.saveSession(
      { accessToken: window.BookingAuth.token() },
      body.data,
    );
    profileStatus.textContent = 'Perfil actualizado correctamente.';
    if (pendingBookingListing) {
      const listing = pendingBookingListing;
      pendingBookingListing = null;
      profileDialog.close();
      await openBookingDetails(listing);
    }
  } catch (error) {
    profileStatus.textContent =
      error.message || 'No se pudo actualizar tu perfil.';
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

async function submitBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !selectedListing) return;
  if (!window.BookingAuth.token()) {
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }
  const useSavedPayment =
    form.elements.paymentSource.value === 'saved' &&
    Boolean(currentUser?.savedPaymentMethod);
  const cardNumber = form
    .querySelector('#sandbox-card-number')
    .value.replace(/\s/g, '');
  if (!useSavedPayment) {
    const expiry = form.querySelector('#sandbox-card-expiry').value;
    const cvv = form.querySelector('#sandbox-card-cvv').value;
    if (cardNumber !== '4242424242424242') {
      showToast('Para esta simulación utiliza la tarjeta de prueba 4242 4242 4242 4242.');
      return;
    }
    if (!isFutureMonth(expiry)) {
      showToast('La fecha de vencimiento debe ser un mes futuro.');
      return;
    }
    if (!/^\d{3}$/.test(cvv)) {
      showToast('El CVV de prueba debe contener tres dígitos.');
      return;
    }
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
    tipoHabitacionCodigo: form.elements.tipoHabitacionCodigo.value,
    cantidadHabitaciones: Number(form.elements.cantidadHabitaciones.value),
    fechaCheckin: formData.get('fechaCheckin').toString(),
    fechaCheckout: formData.get('fechaCheckout').toString(),
    numHuespedes: Number(formData.get('numHuespedes')),
    metodoPagoSimulado: 'tarjeta',
    cotizacionId: form.dataset.cotizacionId,
  };
  const quoteFingerprint = JSON.stringify({
    alojamientoId: selectedListing.codigoIntegracion,
    tipoHabitacionCodigo: payload.tipoHabitacionCodigo,
    fechaInicio: payload.fechaCheckin,
    fechaFin: payload.fechaCheckout,
    cantidadHabitaciones: payload.cantidadHabitaciones,
    ocupantes: { adultos: payload.numHuespedes, ninos: 0 },
  });
  if (
    !payload.cotizacionId ||
    form.dataset.quoteFingerprint !== quoteFingerprint
  ) {
    showToast('Consulta nuevamente disponibilidad y precio antes de confirmar.');
    submitButton.disabled = false;
    submitButton.textContent = originalText;
    return;
  }
  const bookingControls = Array.from(
    form.querySelectorAll('input, select'),
  );
  bookingControls.forEach((control) => {
    control.disabled = true;
  });
  const requestFingerprint = JSON.stringify(payload);
  if (form.dataset.idempotencyFingerprint !== requestFingerprint) {
    form.dataset.idempotencyKey = window.crypto.randomUUID();
    form.dataset.idempotencyFingerprint = requestFingerprint;
  }
  const bookedAccommodation = selectedListing;

  try {
    const response = await fetch(`${API_BASE}/reservas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.BookingAuth.token()}`,
        'Idempotency-Key': form.dataset.idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) {
      window.BookingAuth.clearSession();
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    const body = await readResponse(response);
    let savedCardWarning = '';
    if (!useSavedPayment && form.elements.saveCard.checked) {
      try {
        const saveResponse = await fetch(`${API_BASE}/auth/me/payment-method`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${window.BookingAuth.token()}`,
          },
          body: JSON.stringify({ brand: 'Visa', lastFour: '4242' }),
        });
        const savedCard = await readResponse(saveResponse);
        currentUser = {
          ...currentUser,
          savedPaymentMethod: savedCard.data.savedPaymentMethod,
        };
      } catch (error) {
        savedCardWarning = ` La reserva se confirmó, pero no se guardó la referencia de tarjeta: ${error.message}`;
      }
    }
    detailDialog.close();
    successMessage.textContent = body.warning
      ? `Tu reserva en ${bookedAccommodation.nombre} quedó confirmada. Aviso: ${body.warning}${savedCardWarning}`
      : `Tu reserva en ${bookedAccommodation.nombre} quedó confirmada. Puedes consultarla desde Mis reservas.${savedCardWarning}`;
    form.reset();
    selectedListing = null;
    successDialog.showModal();
    void loadListings();
  } catch (error) {
    showToast(
      error.message || 'No se pudo completar la reserva. Inténtalo de nuevo.',
    );
    form.dispatchEvent(new CustomEvent('booking-failed'));
  } finally {
    form.querySelector('#sandbox-card-number').value = '';
    form.querySelector('#sandbox-card-cvv').value = '';
    bookingControls.forEach((control) => {
      control.disabled = false;
    });
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
}

async function initializeMarketplace() {
  const adminLink = document.querySelector('#admin-mode-link');
  const profileLink = document.querySelector('#profile-link');
  const myBookingsLink = document.querySelector('#my-bookings-link');
  const favoritesLink = document.querySelector('#favorites-link');
  const accountLink = document.querySelector('#account-link');
  adminLink.hidden = true;
  profileLink.hidden = true;
  myBookingsLink.hidden = true;
  favoritesLink.hidden = true;
  favoriteIds = new Set();
  currentUser = null;
  const token = window.BookingAuth.token();
  if (token) {
    try {
      const user = await window.BookingAuth.fetchProfile();
      if (user) {
        currentUser = user;
        if (user.role === 'admin' || user.role === 'empleado') {
          adminLink.hidden = false;
        }
        profileLink.hidden = user.role !== 'cliente';
        myBookingsLink.hidden = user.role !== 'cliente';
        if (user.role === 'cliente') {
          favoritesLink.hidden = false;
          try {
            await refreshFavoriteIds();
          } catch (error) {
            showToast(error.message || 'No se pudieron cargar tus favoritos.');
          }
        }
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

document.querySelector('#profile-link').addEventListener('click', (event) => {
  event.preventDefault();
  if (!window.BookingAuth.token()) {
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }
  profileDialog.showModal();
  void loadMyProfile();
});

document
  .querySelector('#my-bookings-link')
  .addEventListener('click', (event) => {
    event.preventDefault();
    myBookingsDialog.showModal();
    void loadMyBookings();
  });

document.querySelector('#favorites-link').addEventListener('click', (event) => {
  event.preventDefault();
  if (!window.BookingAuth.token()) {
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }
  favoritesDialog.showModal();
  void loadFavorites();
});

async function refreshFavoriteIds() {
  const response = await fetch(`${API_BASE}/favoritos`, {
    headers: { Authorization: `Bearer ${window.BookingAuth.token()}` },
  });
  if (response.status === 401) {
    window.BookingAuth.clearSession();
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }
  const body = await readResponse(response);
  if (!Array.isArray(body?.data)) {
    throw new Error('La API devolvió una lista de favoritos no válida.');
  }
  favoriteIds = new Set(body.data.filter((id) => typeof id === 'string'));
  renderListings(currentListings);
}

async function loadFavorites() {
  favoritesStatus.textContent = 'Cargando favoritos…';
  favoritesList.replaceChildren();
  try {
    await refreshFavoriteIds();
  } catch (error) {
    favoritesStatus.textContent =
      error.message || 'No se pudieron cargar tus favoritos.';
    return;
  }
  const ids = [...favoriteIds];
  if (!ids.length) {
    favoritesStatus.textContent = 'Aún no has guardado alojamientos favoritos.';
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/alojamientos`);
    const body = await readResponse(response);
    const listings = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(listings)) {
      throw new Error('La API devolvió una lista de alojamientos no válida.');
    }
    const favorites = listings.filter((listing) => favoriteIds.has(listing.id));
    if (!favorites.length) {
      favoritesStatus.textContent =
        'Los alojamientos guardados ya no están disponibles.';
      return;
    }
    favoritesStatus.textContent = `${favorites.length} ${
      favorites.length === 1 ? 'alojamiento favorito' : 'alojamientos favoritos'
    }`;
    favoritesList.innerHTML = favorites
      .map(
        (listing) => `
          <article class="my-booking-card favorite-card">
            <div class="my-booking-heading">
              <div>
                <h3>${escapeHtml(listing.nombre)}</h3>
                <p>${escapeHtml(listing.ciudad)}</p>
              </div>
              <button class="secondary-button" type="button" data-remove-favorite-id="${escapeHtml(listing.id)}">Quitar</button>
            </div>
            <strong>${formatMoney(listing.precioBaseNoche, listing.moneda)} / noche</strong>
          </article>`,
      )
      .join('');
  } catch (error) {
    favoritesStatus.textContent =
      error.message || 'No se pudieron cargar tus favoritos.';
  }
}

async function toggleFavorite(id) {
  if (!window.BookingAuth.token()) {
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }
  const wasFavorite = favoriteIds.has(id);
  const response = await fetch(
    wasFavorite
      ? `${API_BASE}/favoritos/${encodeURIComponent(id)}`
      : `${API_BASE}/favoritos`,
    {
      method: wasFavorite ? 'DELETE' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.BookingAuth.token()}`,
      },
      ...(!wasFavorite
        ? { body: JSON.stringify({ alojamientoId: id }) }
        : {}),
    },
  );
  if (response.status === 401) {
    window.BookingAuth.clearSession();
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }
  await readResponse(response);
  if (wasFavorite) favoriteIds.delete(id);
  else favoriteIds.add(id);
  renderListings(currentListings);
  if (favoritesDialog.open) void loadFavorites();
  showToast(wasFavorite ? 'Se quitó de favoritos.' : 'Se agregó a favoritos.');
}

grid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-favorite-id]');
  if (!button) return;
  event.stopPropagation();
  const id = button.dataset.favoriteId;
  button.disabled = true;
  void toggleFavorite(id)
    .catch((error) =>
      showToast(error.message || 'No se pudo actualizar el favorito.'),
    )
    .finally(() => {
      button.disabled = false;
    });
});

favoritesList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-favorite-id]');
  if (!button) return;
  button.disabled = true;
  void toggleFavorite(button.dataset.removeFavoriteId)
    .catch((error) =>
      showToast(error.message || 'No se pudo actualizar el favorito.'),
    )
    .finally(() => {
      button.disabled = false;
    });
});

myBookingsList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-cancel-booking-id]');
  if (!button) return;
  selectedBookingForCancellation = button.dataset.cancelBookingId;
  cancelBookingForm.reset();
  cancelBookingStatus.textContent =
    'Tarjeta de prueba: 4242 4242 4242 4242. Usa una fecha futura y cualquier CVC de tres dígitos.';
  cancelBookingDialog.showModal();
});

function isFutureExpiry(value) {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const now = new Date();
  return year > now.getFullYear() ||
    (year === now.getFullYear() && month >= now.getMonth() + 1);
}

cancelBookingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!cancelBookingForm.reportValidity() || !selectedBookingForCancellation) {
    return;
  }
  const formData = new FormData(cancelBookingForm);
  const cardNumber = formData.get('cardNumber').toString().replace(/\s/g, '');
  const expiry = formData.get('expiry').toString();
  const cvc = formData.get('cvc').toString();
  if (
    cardNumber !== '4242424242424242' ||
    !isFutureExpiry(expiry) ||
    !/^\d{3}$/.test(cvc)
  ) {
    cancelBookingStatus.textContent =
      'Datos de prueba inválidos. Usa la tarjeta indicada, una fecha futura y un CVC de tres dígitos.';
    return;
  }

  const button = cancelBookingForm.querySelector('button[type="submit"]');
  button.disabled = true;
  cancelBookingStatus.textContent = 'Validando los datos de prueba…';
  cancelBookingForm.elements.cardNumber.value = '';
  cancelBookingForm.elements.expiry.value = '';
  cancelBookingForm.elements.cvc.value = '';
  try {
    const response = await fetch(
      `${API_BASE}/reservas/${encodeURIComponent(selectedBookingForCancellation)}/cancelar`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${window.BookingAuth.token()}`,
        },
        body: JSON.stringify({ confirmacionPagoSimulado: true }),
      },
    );
    if (response.status === 401) {
      window.BookingAuth.clearSession();
      cancelBookingDialog.close();
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    const body = await readResponse(response);
    cancelBookingDialog.close();
    showToast(
      body.warning
        ? `Reserva cancelada. ${body.warning}`
        : 'Reserva cancelada. La devolución fue simulada; no se procesó dinero real.',
    );
    await loadMyBookings();
  } catch (error) {
    cancelBookingStatus.textContent =
      error.message || 'No se pudo cancelar la reserva.';
    cancelBookingForm.elements.cardNumber.value = '';
  } finally {
    button.disabled = false;
    selectedBookingForCancellation = null;
  }
});

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
  if (event.target.closest('[data-favorite-id]')) return;
  const card = event.target.closest('[data-listing-index]');
  if (!card) return;
  void openBookingDetails(currentListings[Number(card.dataset.listingIndex)]);
});

async function openBookingDetails(listing) {
  if (!window.BookingAuth.token()) {
    window.BookingAuth.goToLogin('/marketplace/');
    return;
  }

  try {
    const user = await window.BookingAuth.fetchProfile();
    if (!user) {
      window.BookingAuth.goToLogin('/marketplace/');
      return;
    }
    if (user.role !== 'cliente') {
      showToast('Inicia sesión con una cuenta de cliente para reservar.');
      return;
    }
    currentUser = user;
    if (!user.fullName || !user.email || !user.phone) {
      pendingBookingListing = listing;
      profileForm.elements.fullName.value = user.fullName || '';
      profileForm.elements.email.value = user.email || '';
      profileForm.elements.phone.value = user.phone || '';
      profileForm.elements.cedula.value = user.cedula || '';
      profileStatus.textContent =
        'Completa tu nombre, correo y teléfono. Al guardar, continuarás con esta reserva.';
      profileDialog.showModal();
      return;
    }
    if (!listing.codigoIntegracion) {
      throw new Error(
        'Este alojamiento aún no tiene un código de integración y no se puede reservar.',
      );
    }
    const roomsResponse = await fetch(
      `/api/v2/alojamientos/${encodeURIComponent(listing.codigoIntegracion)}/habitaciones`,
    );
    const roomTypes = await readResponse(roomsResponse);
    if (!Array.isArray(roomTypes) || roomTypes.length === 0) {
      throw new Error('Este alojamiento no tiene tipos de habitación disponibles.');
    }
    selectedListing = { ...listing, roomTypes };
    renderDetails(selectedListing);
    detailDialog.showModal();
  } catch (error) {
    showToast(error.message || 'No se pudo validar tu sesión.');
  }
}

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
myBookingsDialog.addEventListener('click', (event) => {
  if (event.target === myBookingsDialog) myBookingsDialog.close();
});
profileDialog.addEventListener('click', (event) => {
  if (event.target === profileDialog) profileDialog.close();
});
favoritesDialog.addEventListener('click', (event) => {
  if (event.target === favoritesDialog) favoritesDialog.close();
});
cancelBookingDialog.addEventListener('click', (event) => {
  if (event.target === cancelBookingDialog) cancelBookingDialog.close();
});
cancelBookingDialog.addEventListener('close', () => {
  cancelBookingForm.reset();
  selectedBookingForCancellation = null;
});
detailDialog.addEventListener('click', (event) => {
  if (event.target === detailDialog) detailDialog.close();
});
successDialog.addEventListener('click', (event) => {
  if (event.target === successDialog) successDialog.close();
});

void initializeMarketplace();
