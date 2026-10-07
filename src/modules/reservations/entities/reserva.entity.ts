import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type EstadoReserva = 'pendiente' | 'confirmada' | 'cancelada';
export type EstadoPago = 'pendiente' | 'exitoso' | 'fallido';

export class ReservaAlojamientoEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  ciudad!: string;
}

export class ReservaEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  alojamientoId!: string;

  @ApiProperty()
  clienteNombre!: string;

  @ApiProperty({ format: 'email' })
  clienteEmail!: string;

  @ApiPropertyOptional({ nullable: true })
  clienteTelefono!: string | null;

  @ApiProperty({ format: 'date' })
  fechaCheckin!: string;

  @ApiProperty({ format: 'date' })
  fechaCheckout!: string;

  @ApiProperty({ example: 2 })
  numHuespedes!: number;

  @ApiProperty({ example: 255 })
  precioTotal!: number;

  @ApiProperty({ example: 'USD' })
  moneda!: string;

  @ApiProperty({ example: 'tarjeta' })
  metodoPagoSimulado!: string;

  @ApiProperty({ enum: ['pendiente', 'exitoso', 'fallido'] })
  pagoEstado!: EstadoPago;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  pagoReferencia!: string | null;

  @ApiProperty({ enum: ['pendiente', 'confirmada', 'cancelada'] })
  estado!: EstadoReserva;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ type: ReservaAlojamientoEntity })
  alojamiento?: ReservaAlojamientoEntity;
}
