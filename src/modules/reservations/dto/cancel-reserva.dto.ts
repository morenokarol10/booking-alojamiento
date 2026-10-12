import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class CancelReservaDto {
  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'Confirma que se completó la validación local de la tarjeta de prueba. No envía datos de tarjeta.',
  })
  @Equals(true)
  confirmacionPagoSimulado!: true;
}
