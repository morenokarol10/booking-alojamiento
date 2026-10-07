import { ApiProperty } from '@nestjs/swagger';
import { AlojamientoEntity } from '../entities/alojamiento.entity';

export class AlojamientoResponseDto {
  @ApiProperty({ type: AlojamientoEntity })
  data!: AlojamientoEntity;

  @ApiProperty()
  message!: string;
}

export class AlojamientosResponseDto {
  @ApiProperty({ type: [AlojamientoEntity] })
  data!: AlojamientoEntity[];

  @ApiProperty()
  message!: string;
}

export class AlojamientoDeleteResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  data!: { id: string; deleted: true };

  @ApiProperty()
  message!: string;
}
