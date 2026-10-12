import { ApiProperty } from '@nestjs/swagger';
import { IsIn, Matches } from 'class-validator';

export class SavePaymentMethodDto {
  @ApiProperty({ enum: ['Visa', 'Mastercard', 'Demo'] })
  @IsIn(['Visa', 'Mastercard', 'Demo'])
  brand!: 'Visa' | 'Mastercard' | 'Demo';

  @ApiProperty({ example: '4242', pattern: '^[0-9]{4}$' })
  @Matches(/^\d{4}$/)
  lastFour!: string;
}
