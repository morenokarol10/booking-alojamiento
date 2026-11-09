import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const EVENT_TYPES = [
  'alojamiento.reserva.confirmada',
  'alojamiento.reserva.cancelada',
  'alojamiento.checkin.completado',
  'alojamiento.checkout.completado',
  'alojamiento.stock.actualizado',
] as const;

export class IntegrationEventFeedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  after = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: (typeof EVENT_TYPES)[number];
}

export class IntegrationInventoryQueryDto {
  @IsDateString({ strict: true })
  desde!: string;

  @IsDateString({ strict: true })
  hasta!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  tipoHabitacion?: string;
}
