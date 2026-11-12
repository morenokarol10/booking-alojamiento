import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ALOJAMIENTO_TIPOS } from '../dto/create-alojamiento.dto';

export class CoordenadasEntity {
  @ApiProperty({ example: -0.2202 })
  latitud!: number;

  @ApiProperty({ example: -78.5123 })
  longitud!: number;
}

export class AlojamientoEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  proveedorId!: string;

  @ApiPropertyOptional({ nullable: true, example: 'HTL-QUITO-001' })
  codigoIntegracion!: string | null;

  @ApiProperty({ example: 'Suite Familiar Quito' })
  nombre!: string;

  @ApiPropertyOptional({ nullable: true })
  descripcion!: string | null;

  @ApiProperty({ enum: ALOJAMIENTO_TIPOS })
  tipo!: (typeof ALOJAMIENTO_TIPOS)[number];

  @ApiProperty({ example: 'Quito' })
  ciudad!: string;

  @ApiProperty({ example: 'Centro Histórico, Quito, Ecuador' })
  direccion!: string;

  @ApiProperty({ type: CoordenadasEntity })
  coordenadas!: CoordenadasEntity;

  @ApiProperty({ example: 85.5 })
  precioBaseNoche!: number;

  @ApiProperty({ example: 'USD' })
  moneda!: string;

  @ApiProperty({ example: 4 })
  capacidadMaxima!: number;

  @ApiProperty({ example: 2 })
  habitacionesDisponibles!: number;

  @ApiProperty({ type: () => [AlojamientoTipoHabitacionEntity] })
  tiposHabitacion!: AlojamientoTipoHabitacionEntity[];

  @ApiProperty({ type: [String], example: ['wifi', 'desayuno'] })
  servicios!: string[];

  @ApiPropertyOptional({ nullable: true })
  politicaCancelacion!: string | null;

  @ApiProperty({ type: [String] })
  imagenes!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AlojamientoTipoHabitacionEntity {
  @ApiProperty({ example: 'HABITACION_DOBLE' })
  codigo!: string;

  @ApiProperty({ example: 'Habitación doble' })
  nombre!: string;

  @ApiPropertyOptional({ nullable: true })
  descripcion!: string | null;

  @ApiProperty({ example: 2, description: 'Habitaciones de este tipo.' })
  cantidad!: number;

  @ApiProperty({ example: 2, description: 'Camas por habitación.' })
  camas!: number;

  @ApiProperty({ example: '2 camas individuales' })
  descripcionCamas!: string;

  @ApiProperty({ example: 2, description: 'Huéspedes por habitación.' })
  capacidadAdultos!: number;

  @ApiProperty({ example: 66 })
  precioNoche!: number;
}
