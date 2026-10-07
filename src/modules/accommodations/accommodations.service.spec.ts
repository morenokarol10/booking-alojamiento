import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccommodationsService } from './accommodations.service';
import type { CreateAlojamientoDto } from './dto/create-alojamiento.dto';

describe('AccommodationsService.create', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs Supabase errors and returns a clear HTTP error', async () => {
    const databaseError = {
      code: '23514',
      message: 'new row violates check constraint',
    };
    const logError = jest.spyOn(console, 'error').mockImplementation();
    const supabase = {
      from: jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: databaseError,
            }),
          })),
        })),
      })),
    } as unknown as SupabaseClient;
    const service = new AccommodationsService(supabase);

    await expect(service.create({} as CreateAlojamientoDto)).rejects.toThrow(
      new BadRequestException(
        'No se pudo crear el alojamiento: new row violates check constraint',
      ),
    );
    expect(logError).toHaveBeenCalledWith(
      'Supabase create alojamiento error:',
      databaseError,
    );
  });
});
