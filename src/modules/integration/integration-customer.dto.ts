import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const DOCUMENT_TYPES = ['CEDULA', 'PASAPORTE', 'RUC'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Huésped sincronizado por Booking. Acepta los nombres del contrato v2.2.0
 * (nombreCompleto, tipoDocumento, identificacion, email, telefono) y los que
 * usa Booking en sus usuarios (nombre, apellido, cedula, tipo_documento,
 * correo). Solo cédula/identificación, nombre y correo son obligatorios.
 */
export class IntegrationCustomerDto {
  @ApiPropertyOptional({ example: 'Juan López' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  nombreCompleto?: string;

  @ApiPropertyOptional({ example: 'Juan', description: 'Alias de Booking.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  nombre?: string;

  @ApiPropertyOptional({ example: 'López', description: 'Alias de Booking.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  apellido?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES, example: 'CEDULA' })
  @IsOptional()
  @Transform(upper)
  @IsIn(DOCUMENT_TYPES)
  tipoDocumento?: DocumentType;

  @ApiPropertyOptional({
    enum: DOCUMENT_TYPES,
    description: 'Alias de Booking.',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(DOCUMENT_TYPES)
  tipo_documento?: DocumentType;

  @ApiPropertyOptional({ example: '1600222176' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(/^([0-9]{10}|[A-Z0-9]{6,12}|[0-9]{13})$/)
  identificacion?: string;

  @ApiPropertyOptional({
    example: '1600222176',
    description: 'Alias de Booking.',
  })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(/^([0-9]{10}|[A-Z0-9]{6,12}|[0-9]{13})$/)
  cedula?: string;

  @ApiPropertyOptional({ example: 'juanlopez@gmail.com' })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @ApiPropertyOptional({
    example: 'juanlopez@gmail.com',
    description: 'Alias de Booking.',
  })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(120)
  correo?: string;

  @ApiPropertyOptional({ example: '0991234567' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^(\+?[0-9]{8,15}|09[0-9]{8})?$/)
  telefono?: string;

  @ApiPropertyOptional({ example: 'Ecuatoriana' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  nacionalidad?: string;
}

export class IntegrationCustomerQueryDto {
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(13)
  identificacion?: string;

  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(13)
  cedula?: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  email?: string;
}
