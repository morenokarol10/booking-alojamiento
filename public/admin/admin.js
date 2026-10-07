const API = '/api/v1';
const TYPE_LABELS = {
  hotel: 'Hotel',
  departamento: 'Departamento',
  villa: 'Villa',
};
const STATUS_LABELS = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
};
const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=240&q=75';

const listingBody = document.querySelector('#listing-table-body');
const bookingBody = document.querySelector('#booking-table-body');
const eventBody = document.querySelector('#event-table-body');
const listingModal = document.querySelector('#listing-modal');
const listingForm = document.querySelector('#listing-form');
const deleteDialog = document.querySelector('#delete-dialog');
const toast = document.querySelector('#admin-toast');
let listings = [];
let pendingDelete = null;
let toastTimeout;

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

function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      'No se pudo conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.',
    );
  }

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

function setLoadingRow(target, colspan, message) {
  target.innerHTML = `<tr><td colspan="${colspan}" class="loading-cell">${escapeHtml(message)}</td></tr>`;
}

function showSectionError(selector, message) {
  const error = document.querySelector(selector);
  error.textContent = message;
  error.hidden = false;
}

async function loadListings() {
  const error = document.querySelector('#listing-error');
  error.hidden = true;
  setLoadingRow(listingBody, 7, 'Cargando alojamientos…');
  try {
    const result = await apiRequest('/alojamientos');
    listings = Array.isArray(result) ? result : result.data;
    if (!Array.isArray(listings)) {
      throw new Error('La API devolvió una lista de alojamientos no válida.');
    }
    document.querySelector('#stat-listings').textContent = String(
      listings.length,
    );
    document.querySelector('#nav-listing-count').textContent = String(
      listings.length,
    );
    renderListings();
  } catch (requestError) {
    listings = [];
    setLoadingRow(listingBody, 7, 'No se pudieron cargar los alojamientos.');
    document.querySelector('#stat-listings').textContent = '—';
    document.querySelector('#nav-listing-count').textContent = '—';
    showSectionError('#listing-error', requestError.message);
  }
}

function renderListings() {
  const query = document
    .querySelector('#listing-search')
    .value.trim()
    .toLocaleLowerCase('es');
  const visibleListings = listings.filter((listing) =>
    `${listing.nombre} ${listing.ciudad} ${listing.tipo}`
      .toLocaleLowerCase('es')
      .includes(query),
  );
  document.querySelector('#listing-table-count').textContent =
    `${visibleListings.length} de ${listings.length} ${listings.length === 1 ? 'alojamiento' : 'alojamientos'}`;

  if (!visibleListings.length) {
    setLoadingRow(
      listingBody,
      7,
      listings.length
        ? 'No hay alojamientos que coincidan con la búsqueda.'
        : 'Aún no hay alojamientos registrados.',
    );
    return;
  }

  listingBody.innerHTML = visibleListings
    .map(
      (listing) => `
        <tr>
          <td>
            <div class="listing-cell">
              <img class="listing-thumb" src="${escapeHtml(listing.imagenes?.[0] || FALLBACK_IMAGE)}" alt="" loading="lazy" />
              <span><strong title="${escapeHtml(listing.nombre)}">${escapeHtml(listing.nombre)}</strong><small>ID · ${escapeHtml(String(listing.id || '').slice(0, 8))}</small></span>
            </div>
          </td>
          <td><span class="type-badge">${escapeHtml(TYPE_LABELS[listing.tipo] || listing.tipo)}</span></td>
          <td>${escapeHtml(listing.ciudad)}</td>
          <td class="price-cell">${formatMoney(listing.precioBaseNoche, listing.moneda)}</td>
          <td class="capacity-cell">${Number(listing.capacidadMaxima) || 0} personas</td>
          <td><span class="status-badge ${Number(listing.habitacionesDisponibles) > 0 ? 'available' : 'unavailable'}">${Number(listing.habitacionesDisponibles) > 0 ? `${Number(listing.habitacionesDisponibles)} disponible(s)` : 'Agotado'}</span></td>
          <td class="actions-cell">
            <button class="row-action" type="button" data-action="edit" data-id="${escapeHtml(listing.id)}" aria-label="Editar ${escapeHtml(listing.nombre)}">Editar</button>
            <button class="row-action delete" type="button" data-action="delete" data-id="${escapeHtml(listing.id)}" aria-label="Eliminar ${escapeHtml(listing.nombre)}">Eliminar</button>
          </td>
        </tr>`,
    )
    .join('');
}

async function loadBookings() {
  const error = document.querySelector('#booking-error');
  error.hidden = true;
  setLoadingRow(bookingBody, 6, 'Cargando reservas…');
  try {
    const result = await apiRequest('/reservas');
    const bookings = Array.isArray(result) ? result : result.data;
    if (!Array.isArray(bookings)) {
      throw new Error('La API devolvió una lista de reservas no válida.');
    }
    document.querySelector('#stat-bookings').textContent = String(
      bookings.length,
    );
    document.querySelector('#nav-booking-count').textContent = String(
      bookings.length,
    );
    document.querySelector('#booking-table-count').textContent =
      `${bookings.length} ${bookings.length === 1 ? 'reserva' : 'reservas'} recibidas`;

    if (!bookings.length) {
      setLoadingRow(bookingBody, 6, 'Todavía no se han recibido reservas.');
      document.querySelector('#stat-revenue').textContent = formatMoney(0);
      return;
    }

    const revenueByCurrency = bookings.reduce((totals, booking) => {
      if (booking.estado !== 'cancelada') {
        const currency = booking.moneda || 'USD';
        totals.set(
          currency,
          (totals.get(currency) || 0) + (Number(booking.precioTotal) || 0),
        );
      }
      return totals;
    }, new Map());
    document.querySelector('#stat-revenue').textContent =
      revenueByCurrency.size > 0
        ? Array.from(revenueByCurrency, ([currency, total]) =>
            formatMoney(total, currency),
          ).join(' · ')
        : formatMoney(0);
    bookingBody.innerHTML = bookings
      .map((booking) => {
        const accommodation = booking.alojamiento?.nombre || 'Alojamiento';
        const status = STATUS_LABELS[booking.estado] || booking.estado || '—';
        return `
          <tr>
            <td><div class="guest-cell"><strong>${escapeHtml(booking.clienteNombre)}</strong><small>${escapeHtml(booking.clienteEmail)}</small></div></td>
            <td>${escapeHtml(accommodation)}</td>
            <td class="stay-cell">${formatDate(booking.fechaCheckin)} – ${formatDate(booking.fechaCheckout)}</td>
            <td class="price-cell">${formatMoney(booking.precioTotal, booking.moneda)}</td>
            <td><span class="status-badge ${escapeHtml(booking.estado)}">${escapeHtml(status)}</span></td>
            <td>${formatDate(booking.createdAt)}</td>
          </tr>`;
      })
      .join('');
  } catch (requestError) {
    document.querySelector('#stat-bookings').textContent = '—';
    document.querySelector('#stat-revenue').textContent = '—';
    document.querySelector('#nav-booking-count').textContent = '—';
    document.querySelector('#booking-table-count').textContent =
      'No se pudieron consultar las reservas';
    setLoadingRow(bookingBody, 6, 'No se pudieron cargar las reservas.');
    showSectionError('#booking-error', requestError.message);
  }
}

async function loadEvents() {
  const error = document.querySelector('#event-error');
  error.hidden = true;
  setLoadingRow(eventBody, 3, 'Consultando eventos registrados…');
  try {
    const result = await apiRequest('/admin/eventos?limit=50');
    const events = Array.isArray(result) ? result : result.data;
    if (!Array.isArray(events)) {
      throw new Error('La API devolvió un registro de eventos no válido.');
    }
    document.querySelector('#stat-events').textContent = String(events.length);
    document.querySelector('#event-count-pill').textContent =
      `${events.length} ${events.length === 1 ? 'evento' : 'eventos'}`;
    document.querySelector('#event-table-count').textContent =
      `${events.length} ${events.length === 1 ? 'evento registrado' : 'eventos registrados'}`;

    if (!events.length) {
      setLoadingRow(
        eventBody,
        3,
        'Aún no hay eventos. Al crear una reserva, aparecerá aquí.',
      );
      return;
    }

    eventBody.innerHTML = events
      .map((event) => {
        const payload =
          typeof event.payload === 'string'
            ? event.payload
            : JSON.stringify(event.payload ?? {});
        return `
          <tr>
            <td><span class="event-badge">${escapeHtml(event.tipoEvento)}</span></td>
            <td><div class="payload-preview" title="${escapeHtml(payload)}">${escapeHtml(payload)}</div></td>
            <td class="event-time">${formatDate(event.creadoEn, true)}</td>
          </tr>`;
      })
      .join('');
  } catch (requestError) {
    document.querySelector('#stat-events').textContent = '—';
    document.querySelector('#event-count-pill').textContent = 'Sin conexión';
    document.querySelector('#event-table-count').textContent =
      'No se pudo consultar el registro EDA';
    setLoadingRow(
      eventBody,
      3,
      'No se pudieron cargar los eventos registrados.',
    );
    showSectionError('#event-error', requestError.message);
  }
}

function resetFormError() {
  const error = document.querySelector('#form-error');
  error.hidden = true;
  error.textContent = '';
}

function openCreateModal() {
  listingForm.reset();
  listingForm.elements.id.value = '';
  listingForm.elements.moneda.value = 'USD';
  listingForm.elements.habitacionesDisponibles.value = '1';
  document.querySelector('#listing-modal-title').textContent =
    'Agregar alojamiento';
  document.querySelector('#save-listing-button').textContent =
    'Guardar alojamiento';
  resetFormError();
  listingModal.showModal();
  listingForm.elements.proveedorId.focus();
}

function openEditModal(listing) {
  listingForm.reset();
  for (const field of [
    'id',
    'proveedorId',
    'nombre',
    'tipo',
    'ciudad',
    'direccion',
    'precioBaseNoche',
    'moneda',
    'capacidadMaxima',
    'habitacionesDisponibles',
    'descripcion',
    'politicaCancelacion',
  ]) {
    listingForm.elements[field].value = listing[field] ?? '';
  }
  listingForm.elements.latitud.value = listing.coordenadas?.latitud ?? '';
  listingForm.elements.longitud.value = listing.coordenadas?.longitud ?? '';
  listingForm.elements.servicios.value = (listing.servicios || []).join(', ');
  listingForm.elements.imagenes.value = (listing.imagenes || []).join(', ');
  document.querySelector('#listing-modal-title').textContent =
    'Editar alojamiento';
  document.querySelector('#save-listing-button').textContent =
    'Guardar cambios';
  resetFormError();
  listingModal.showModal();
  listingForm.elements.proveedorId.focus();
}

function setButtonBusy(button, busy, text) {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || text;
    delete button.dataset.originalText;
  }
}

listingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetFormError();
  if (!listingForm.reportValidity()) return;

  const formData = new FormData(listingForm);
  const id = String(formData.get('id') || '');
  const payload = {
    proveedorId: String(formData.get('proveedorId')).trim(),
    nombre: String(formData.get('nombre')).trim(),
    tipo: formData.get('tipo'),
    ciudad: String(formData.get('ciudad')).trim(),
    direccion: String(formData.get('direccion')).trim(),
    coordenadas: {
      latitud: Number(formData.get('latitud')),
      longitud: Number(formData.get('longitud')),
    },
    precioBaseNoche: Number(formData.get('precioBaseNoche')),
    moneda: String(formData.get('moneda')).trim().toUpperCase(),
    capacidadMaxima: Number(formData.get('capacidadMaxima')),
    habitacionesDisponibles: Number(formData.get('habitacionesDisponibles')),
    servicios: String(formData.get('servicios') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    politicaCancelacion: String(
      formData.get('politicaCancelacion') || '',
    ).trim(),
    imagenes: String(formData.get('imagenes'))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    descripcion: String(formData.get('descripcion') || '').trim(),
  };
  const submitButton = document.querySelector('#save-listing-button');
  setButtonBusy(submitButton, true, 'Guardando…');

  try {
    await apiRequest(
      id ? `/alojamientos/${encodeURIComponent(id)}` : '/alojamientos',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );
    listingModal.close();
    showToast(
      id
        ? 'Alojamiento actualizado correctamente.'
        : 'Alojamiento creado correctamente.',
    );
    await loadListings();
  } catch (requestError) {
    const formError = document.querySelector('#form-error');
    formError.textContent = requestError.message;
    formError.hidden = false;
  } finally {
    setButtonBusy(
      submitButton,
      false,
      id ? 'Guardar cambios' : 'Guardar alojamiento',
    );
  }
});

function askDelete(listing) {
  pendingDelete = listing;
  document.querySelector('#delete-description').textContent =
    `Se eliminará “${listing.nombre}”. Esta acción no se puede deshacer.`;
  const error = document.querySelector('#delete-error');
  error.hidden = true;
  error.textContent = '';
  deleteDialog.showModal();
}

document
  .querySelector('#confirm-delete-button')
  .addEventListener('click', async (event) => {
    if (!pendingDelete) return;
    const button = event.currentTarget;
    const error = document.querySelector('#delete-error');
    error.hidden = true;
    setButtonBusy(button, true, 'Eliminando…');

    try {
      await apiRequest(
        `/alojamientos/${encodeURIComponent(pendingDelete.id)}`,
        {
          method: 'DELETE',
        },
      );
      deleteDialog.close();
      showToast('Alojamiento eliminado correctamente.');
      pendingDelete = null;
      await loadListings();
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
    } finally {
      setButtonBusy(button, false, 'Sí, eliminar');
    }
  });

listingBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const listing = listings.find((item) => item.id === button.dataset.id);
  if (!listing) return;
  if (button.dataset.action === 'edit') openEditModal(listing);
  if (button.dataset.action === 'delete') askDelete(listing);
});

document
  .querySelector('#listing-search')
  .addEventListener('input', renderListings);
document
  .querySelector('#add-listing-button')
  .addEventListener('click', openCreateModal);
document
  .querySelector('#add-listing-button-top')
  .addEventListener('click', openCreateModal);
document
  .querySelector('#refresh-button')
  .addEventListener('click', loadListings);
document
  .querySelector('#refresh-bookings')
  .addEventListener('click', loadBookings);
document.querySelector('#refresh-events').addEventListener('click', loadEvents);

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector(`#${button.dataset.close}`).close();
  });
});
for (const dialog of [listingModal, deleteDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
deleteDialog.addEventListener('close', () => {
  if (!document.querySelector('#confirm-delete-button').disabled) {
    pendingDelete = null;
  }
});

document.querySelector('#current-date').textContent = new Intl.DateTimeFormat(
  'es-EC',
  {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  },
)
  .format(new Date())
  .toLocaleUpperCase('es');

document.querySelectorAll('.side-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.side-link').forEach((item) => {
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    });
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
  });
});

document
  .querySelector('#mobile-menu-button')
  .addEventListener('click', (event) => {
    const expanded =
      event.currentTarget.getAttribute('aria-expanded') === 'true';
    event.currentTarget.setAttribute('aria-expanded', String(!expanded));
    document
      .querySelector('.sidebar')
      .classList.toggle('mobile-open', !expanded);
  });

Promise.all([loadListings(), loadBookings(), loadEvents()]);
