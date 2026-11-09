import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const PAYMENT_METHODS = [
  'TARJETA_CREDITO',
  'TARJETA_DEBITO',
  'TRANSFERENCIA',
  'SIMULADO',
  'PAGO_EN_SITIO',
] as const;

const DOCUMENT_TYPES = ['CEDULA', 'PASAPORTE', 'RUC'] as const;

class IntegrationGuestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^\S+(\s+\S+)+$/)
  nombreCompleto!: string;

  @IsIn(DOCUMENT_TYPES)
  tipoDocumento!: (typeof DOCUMENT_TYPES)[number];

  @IsString()
  @MaxLength(13)
  identificacion!: string;

  @IsEmail()
  @MaxLength(120)
  email!: string;

  @IsString()
  @Matches(/^(\+[0-9]{8,15}|09[0-9]{8})$/)
  telefono!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nacionalidad?: string;
}

class LegacyCustomerContactDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^\S+(\s+\S+)+$/)
  full_name!: string;

  @IsEmail()
  @MaxLength(120)
  email!: string;

  @IsString()
  @Matches(/^(\+[0-9]{8,15}|09[0-9]{8})$/)
  phone!: string;

  @IsIn(DOCUMENT_TYPES)
  document_type!: (typeof DOCUMENT_TYPES)[number];

  @IsString()
  @MaxLength(13)
  document_id!: string;
}

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

class IntegrationPackageDto {
  @IsUUID()
  paqueteId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  descuentoPorcentaje!: number;

  @IsNumberString()
  @Matches(/^\d+\.\d{2}$/)
  descuentoMonto!: string;
}

class IntegrationAdditionalGuestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombreCompleto!: string;

  @IsOptional()
  @IsIn(['CEDULA', 'PASAPORTE', 'MENOR_SIN_DOC'])
  tipoDocumento?: 'CEDULA' | 'PASAPORTE' | 'MENOR_SIN_DOC';

  @IsOptional()
  @IsString()
  @MaxLength(13)
  @Matches(/^([0-9]{10}|[A-Z0-9]{6,12}|[0-9]{13})?$/)
  identificacion?: string;

  @IsOptional()
  @IsBoolean()
  esMenorEdad?: boolean;

  @ValidateIf((guest) => guest.esMenorEdad === true || guest.edad !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  edad?: number;
}

export class IntegrationOrderCreateDto {
  @IsString()
  @MaxLength(64)
  alojamientoId!: string;

  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  tipoHabitacionCodigo!: string;

  @IsDateString({ strict: true })
  fechaInicio!: string;

  @IsDateString({ strict: true })
  fechaFin!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  cantidadHabitaciones = 1;

  @ValidateNested()
  @Type(() => IntegrationOccupantsDto)
  ocupantes!: IntegrationOccupantsDto;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  regimenSeleccionado?: string;

  @IsOptional()
  @IsUUID()
  cotizacionId?: string;

  @IsNumberString()
  @Matches(/^\d+\.\d{2}$/)
  totalPagar!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationPackageDto)
  paquete?: IntegrationPackageDto;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  payment_method?: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  payment_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  saga_id?: string;

  @IsOptional()
  @IsUUID('4')
  idempotency_key?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationGuestDto)
  huespedTitular?: IntegrationGuestDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LegacyCustomerContactDto)
  customer_contact?: LegacyCustomerContactDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => IntegrationAdditionalGuestDto)
  huespedesAdicionales?: IntegrationAdditionalGuestDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  peticionesEspeciales?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,30}$/)
  planTarifaCodigo?: string;
}

export class IntegrationCancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;

  @IsOptional()
  @IsIn(['SAGA_ORCHESTRATOR', 'CLIENTE', 'ADMIN', 'HOTEL'])
  solicitadoPor: 'SAGA_ORCHESTRATOR' | 'CLIENTE' | 'ADMIN' | 'HOTEL' =
    'CLIENTE';
}
