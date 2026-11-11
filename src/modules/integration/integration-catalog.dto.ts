import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const REGIMENS = [
  'SOLO_HABITACION',
  'DESAYUNO_INCLUIDO',
  'MEDIA_PENSION',
  'PENSION_COMPLETA',
  'TODO_INCLUIDO',
] as const;

class IntegrationOccupantsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  adultos!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  ninos = 0;
}

export class IntegrationCatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ciudad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  estrellas?: number;

  @IsOptional()
  @IsNumberString()
  @MaxLength(16)
  minPrecio?: string;

  @IsOptional()
  @IsNumberString()
  @MaxLength(16)
  maxPrecio?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  permitePaquete?: boolean;

  @IsOptional()
  @IsDateString({ strict: true })
  actualizadoDesde?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

export class IntegrationSearchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  camas?: number;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  destino!: string;

  @IsDateString({ strict: true })
  fechaInicio!: string;

  @IsDateString({ strict: true })
  fechaFin!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  adultos!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  ninos = 0;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true })
  edadesNinos?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  habitaciones = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  estrellasMinimas?: number;

  @IsOptional()
  @IsNumberString()
  @MaxLength(16)
  @Matches(/^\d+\.\d{2}$/)
  precioMaximo?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  amenidadesDeseadas?: string[];

  @IsOptional()
  @IsIn(REGIMENS)
  regimen?: (typeof REGIMENS)[number];

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  permitePaquete?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

export class IntegrationAvailabilityDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  camas?: number;

  @IsString()
  @MaxLength(64)
  alojamientoId!: string;

  @IsDateString({ strict: true })
  fechaInicio!: string;

  @IsDateString({ strict: true })
  fechaFin!: string;

  @IsString()
  @MaxLength(40)
  tipoHabitacionCodigo!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  cantidadHabitaciones = 1;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationOccupantsDto)
  ocupantes?: IntegrationOccupantsDto;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  planTarifaCodigo?: string;
}

export class IntegrationPropertyAvailabilityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  camas?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  beds?: number;

  @IsDateString({ strict: true })
  checkin!: string;

  @IsDateString({ strict: true })
  checkout!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  habitaciones?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rooms?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  tipoHabitacion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  adultos?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  adults?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  ninos?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  children?: number;
}

export class IntegrationOccupancyCalendarQueryDto {
  @IsDateString({ strict: true })
  desde!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  dias = 60;

  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  tipoHabitacion!: string;
}
