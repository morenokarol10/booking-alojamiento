import { ApiProperty } from '@nestjs/swagger';
import { ReservaEntity } from '../entities/reserva.entity';

export class ReservaResponseDto {
  @ApiProperty({ type: ReservaEntity })
  data!: ReservaEntity;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      estado: 'exitoso',
      referencia: 'c0440f2d-2ba3-4cbb-9952-1b6cdf488afa',
      simulado: true,
    },
  })
  pago!: {
    estado: 'exitoso';
    referencia: string;
    simulado: true;
  };

  @ApiProperty()
  message!: string;
}

export class ReservasResponseDto {
  @ApiProperty({ type: [ReservaEntity] })
  data!: ReservaEntity[];

  @ApiProperty()
  message!: string;
}
