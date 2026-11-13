import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEcuadorianCedula, IsStrongPassword } from '../../auth/account-rules';
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

  @ApiProperty({ minLength: 8, example: 'Usuario1!' })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({
    example: '1600222176',
    description:
      'Cédula ecuatoriana (la pide Booking para identificar al huésped).',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEcuadorianCedula()
  cedula!: string;

  @ApiProperty({ enum: ['admin', 'empleado', 'cliente'], example: 'empleado' })
  @IsIn(['admin', 'empleado', 'cliente'])
  role!: UserRole;
}
