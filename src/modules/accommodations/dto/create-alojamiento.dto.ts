import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const ALOJAMIENTO_TIPOS = ['hotel', 'departamento', 'villa'] as const;

export class CoordenadasDto {
  @ApiProperty({ example: -0.2202, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud!: number;

  @ApiProperty({ example: -78.5123, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud!: number;
}

export class CreateAlojamientoDto {
  @ApiProperty({
    format: 'uuid',
    example: '20000000-0000-4000-8000-000000000001',
  })
  @IsUUID()
  proveedorId!: string;

  @ApiProperty({ example: 'Suite Familiar Quito', minLength: 3 })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  nombre!: string;

  @ApiPropertyOptional({
    example: 'Suite amplia cerca del centro histórico.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @ApiProperty({ enum: ALOJAMIENTO_TIPOS, example: 'hotel' })
  @IsIn(ALOJAMIENTO_TIPOS)
  tipo!: (typeof ALOJAMIENTO_TIPOS)[number];

  @ApiProperty({ example: 'Quito' })
  @IsString()
  @MaxLength(120)
  ciudad!: string;

  @ApiProperty({ example: 'Centro Histórico, Quito, Ecuador' })
  @IsString()
  @MaxLength(240)
  direccion!: string;

  @ApiProperty({ type: CoordenadasDto })
  @ValidateNested()
  @Type(() => CoordenadasDto)
  coordenadas!: CoordenadasDto;

  @ApiProperty({ example: 85.5, minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioBaseNoche!: number;

  @ApiPropertyOptional({
    example: 'USD',
    default: 'USD',
    pattern: '^[A-Z]{3}$',
  })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  moneda?: string;

  @ApiProperty({ example: 4, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacidadMaxima!: number;

  @ApiProperty({ example: 2, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  habitacionesDisponibles!: number;

  @ApiPropertyOptional({ type: [String], example: ['wifi', 'desayuno'] })
  @Transform(({ value }) => normalizeStringArray(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  servicios?: string[];

  @ApiPropertyOptional({
    example: 'Cancelación gratuita hasta 48 horas antes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  politicaCancelacion?: string;

  @ApiProperty({
    type: [String],
    example: ['https://images.unsplash.com/photo-example'],
  })
  @Transform(({ value }) => normalizeStringArray(value))
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl({ require_protocol: true }, { each: true })
  imagenes!: string[];
}

function normalizeStringArray(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : item))
      .filter((item) => item !== '');
  }
  if (typeof value !== 'string') return value;

  const trimmedValue = value.trim();
  if (trimmedValue.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmedValue);
      if (Array.isArray(parsed)) return normalizeStringArray(parsed);
    } catch {
      // Fall through to comma-separated input; DTO validation reports invalid items.
    }
  }

  return trimmedValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
