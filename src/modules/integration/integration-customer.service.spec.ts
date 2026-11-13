import { IntegrationCustomerService } from './integration-customer.service';

describe('IntegrationCustomerService', () => {
  const guest = {
    nombreCompleto: 'Joselyn Cadena',
    tipoDocumento: 'CEDULA' as const,
    identificacion: '1712345675',
    email: 'Joselyn@example.com',
    telefono: '+593991234567',
    nacionalidad: 'Ecuatoriana',
  };

  const createSupabase = (
    row: Record<string, unknown>,
    sameDocumentRows: unknown[] = [],
  ) => {
    const lookup = {
      select: jest.fn(),
      eq: jest.fn(),
      neq: jest.fn(),
      limit: jest
        .fn()
        .mockResolvedValue({ data: sameDocumentRows, error: null }),
    };
    lookup.select.mockReturnValue(lookup);
    lookup.eq.mockReturnValue(lookup);
    lookup.neq.mockReturnValue(lookup);
    const write = {
      upsert: jest.fn(),
      select: jest.fn(),
      single: jest.fn().mockResolvedValue({ data: row, error: null }),
    };
    write.upsert.mockReturnValue(write);
    write.select.mockReturnValue(write);
    const from = jest
      .fn()
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(write);
    return { from, write };
  };

  const storedRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'customer-uuid',
    nombre_completo: guest.nombreCompleto,
    tipo_documento: guest.tipoDocumento,
    identificacion: guest.identificacion,
    email: 'joselyn@example.com',
    telefono: guest.telefono,
    nacionalidad: guest.nacionalidad,
    created_at: '2026-12-11T00:00:00.000Z',
    updated_at: '2026-12-11T00:00:00.000Z',
    ...overrides,
  });

  it('upserts guests by normalized email and returns the synchronized record', async () => {
    const { from, write } = createSupabase(storedRow());
    const service = new IntegrationCustomerService({ from } as never);

    await expect(service.synchronize(guest)).resolves.toMatchObject({
      data: {
        id: 'customer-uuid',
        email: 'joselyn@example.com',
        nombreCompleto: guest.nombreCompleto,
      },
    });
    expect(write.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'joselyn@example.com' }),
      { onConflict: 'email' },
    );
  });

  it('accepts the Booking user fields: cedula, nombre, apellido and correo without phone', async () => {
    const { from, write } = createSupabase(
      storedRow({
        nombre_completo: 'Juan López',
        identificacion: '1600222176',
        email: 'juanlopez@gmail.com',
        telefono: '',
        nacionalidad: null,
      }),
    );
    const service = new IntegrationCustomerService({ from } as never);

    const result = await service.synchronize({
      cedula: '1600222176',
      nombre: 'Juan',
      apellido: 'López',
      correo: 'JuanLopez@gmail.com',
    });

    expect(write.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre_completo: 'Juan López',
        tipo_documento: 'CEDULA',
        identificacion: '1600222176',
        email: 'juanlopez@gmail.com',
        telefono: '',
      }),
      { onConflict: 'email' },
    );
    expect(result.data).toMatchObject({
      cedula: '1600222176',
      telefono: null,
    });
  });

  it('rejects invalid Ecuadorian identity numbers without writing the record', async () => {
    const from = jest.fn();
    const service = new IntegrationCustomerService({ from } as never);

    await expect(
      service.synchronize({ ...guest, identificacion: '1712345670' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(from).not.toHaveBeenCalled();
  });

  it('asks for the missing data when the guest has no identification', async () => {
    const from = jest.fn();
    const service = new IntegrationCustomerService({ from } as never);

    await expect(
      service.synchronize({ nombre: 'Juan', correo: 'juan@example.com' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses the same identification with a different email', async () => {
    const { from, write } = createSupabase(storedRow(), [
      { email: 'otro@example.com' },
    ]);
    const service = new IntegrationCustomerService({ from } as never);

    await expect(service.synchronize(guest)).rejects.toMatchObject({
      status: 409,
    });
    expect(write.upsert).not.toHaveBeenCalled();
  });
});
