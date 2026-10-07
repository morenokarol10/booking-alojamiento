import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAlojamientoDto } from './create-alojamiento.dto';

describe('CreateAlojamientoDto transformations', () => {
  it('converts comma-separated values and numeric strings before validation', () => {
    const dto = plainToInstance(CreateAlojamientoDto, {
      proveedorId: '20000000-0000-4000-8000-000000000001',
      nombre: 'Suite Quito',
      tipo: 'hotel',
      ciudad: 'Quito',
      direccion: 'Centro Histórico',
      coordenadas: { latitud: '-0.22', longitud: '-78.51' },
      precioBaseNoche: '85.5',
      capacidadMaxima: '4',
      habitacionesDisponibles: '2',
      servicios: ' WiFi, Desayuno incluido, ',
      imagenes: 'https://example.com/one.jpg, https://example.com/two.jpg',
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.coordenadas).toEqual({ latitud: -0.22, longitud: -78.51 });
    expect(dto.precioBaseNoche).toBe(85.5);
    expect(dto.capacidadMaxima).toBe(4);
    expect(dto.habitacionesDisponibles).toBe(2);
    expect(dto.servicios).toEqual(['WiFi', 'Desayuno incluido']);
    expect(dto.imagenes).toEqual([
      'https://example.com/one.jpg',
      'https://example.com/two.jpg',
    ]);
  });
});
