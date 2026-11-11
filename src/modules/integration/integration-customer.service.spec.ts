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

  it('upserts guests by normalized email and returns the synchronized record', async () => {
    const row = {
      id: 'customer-uuid',
      nombre_completo: guest.nombreCompleto,
      tipo_documento: guest.tipoDocumento,
      identificacion: guest.identificacion,
      email: 'joselyn@example.com',
      telefono: guest.telefono,
      nacionalidad: guest.nacionalidad,
      created_at: '2026-12-11T00:00:00.000Z',
      updated_at: '2026-12-11T00:00:00.000Z',
    };
    const query = {
      upsert: jest.fn(),
      select: jest.fn(),
      single: jest.fn().mockResolvedValue({ data: row, error: null }),
    };
    query.upsert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const from = jest.fn().mockReturnValue(query);
    const service = new IntegrationCustomerService({ from } as never);

    await expect(service.synchronize(guest)).resolves.toMatchObject({
      data: {
        id: 'customer-uuid',
        email: 'joselyn@example.com',
        nombreCompleto: guest.nombreCompleto,
      },
    });
    expect(query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'joselyn@example.com' }),
      { onConflict: 'email' },
    );
  });

  it('rejects invalid Ecuadorian identity numbers without writing the record', async () => {
    const from = jest.fn();
    const service = new IntegrationCustomerService({ from } as never);

    await expect(
      service.synchronize({ ...guest, identificacion: '1712345670' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(from).not.toHaveBeenCalled();
  });
});
