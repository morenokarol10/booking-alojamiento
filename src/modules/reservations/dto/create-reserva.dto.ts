import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
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
