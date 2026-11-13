import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsEcuadorianCedula } from '../account-rules';

export class UpdateProfileDto {
  @ApiProperty({ example: 'María Pérez', minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @ApiProperty({ example: '+593991234567', minLength: 5, maxLength: 32 })
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ example: 'cliente@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: '1600222176' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined,
  )
  @IsEcuadorianCedula()
  cedula?: string;
}
