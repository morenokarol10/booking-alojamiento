import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { UserRole } from '../../auth/auth.types';

export class CreateManagedUserDto {
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

  @ApiProperty({ example: 'persona@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 12, example: 'UsuarioSeguro123!' })
  @IsString()
  @MinLength(12)
  password!: string;

  @ApiProperty({ enum: ['admin', 'empleado', 'cliente'], example: 'empleado' })
  @IsIn(['admin', 'empleado', 'cliente'])
  role!: UserRole;
}
