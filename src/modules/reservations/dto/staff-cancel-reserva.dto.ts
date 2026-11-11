import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const STAFF_CANCELLATION_SOURCES = ['HUESPED', 'HOTEL'] as const;
export type StaffCancellationSource =
  (typeof STAFF_CANCELLATION_SOURCES)[number];

export class StaffCancelReservaDto {
  @ApiProperty({
    enum: STAFF_CANCELLATION_SOURCES,
    description:
      'HUESPED: el huésped pidió cancelar (se aplica la política: 100 % de reembolso hasta 48 h antes del check-in, luego 0 %). HOTEL: el hotel cancela por causa propia (reembolso 100 %).',
  })
  @IsIn(STAFF_CANCELLATION_SOURCES)
  solicitadoPor!: StaffCancellationSource;

  @ApiProperty({
    minLength: 3,
    maxLength: 300,
    example: 'El huésped llamó para cancelar por motivos de salud.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  motivo!: string;
}
