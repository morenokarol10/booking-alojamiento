import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'cliente@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 12, example: 'ClienteSeguro123!' })
  @IsString()
  @MinLength(12)
  password!: string;
}
