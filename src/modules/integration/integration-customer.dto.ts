import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const DOCUMENT_TYPES = ['CEDULA', 'PASAPORTE', 'RUC'] as const;

export class IntegrationCustomerDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^\S+(\s+\S+)+$/)
  nombreCompleto!: string;

  @IsIn(DOCUMENT_TYPES)
  tipoDocumento!: (typeof DOCUMENT_TYPES)[number];

  @IsString()
  @MaxLength(13)
  @Matches(/^([0-9]{10}|[A-Z0-9]{6,12}|[0-9]{13})$/)
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
