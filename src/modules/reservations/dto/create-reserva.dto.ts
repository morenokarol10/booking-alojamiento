import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReservaDto {
  @ApiProperty({
    format: 'uuid',
    example: '10000000-0000-4000-8000-000000000001',
  })
  @IsUUID()
  alojamientoId!: string;

  @ApiProperty({ format: 'date', example: '2026-11-10' })
  @IsDateString({ strict: true })
  fechaCheckin!: string;

  @ApiProperty({ format: 'date', example: '2026-11-13' })
  @IsDateString({ strict: true })
  fechaCheckout!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numHuespedes!: number;

  @ApiPropertyOptional({
    example: 'HABITACION_ESTANDAR',
    pattern: '^[A-Z0-9_]{2,40}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  tipoHabitacionCodigo?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  cantidadHabitaciones?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cotizacionId?: string;

  @ApiProperty({
    example: 'tarjeta',
    description:
      'Método de pago ficticio; no se procesan cargos reales en este prototipo.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  metodoPagoSimulado!: string;
}
