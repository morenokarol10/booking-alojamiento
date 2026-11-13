import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEcuadorianCedula, IsStrongPassword } from '../account-rules';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
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

  @ApiProperty({
    minLength: 8,
    example: 'Cliente1!',
    description:
      'Mínimo 8 caracteres, una mayúscula, un número y un carácter especial.',
  })
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
}
