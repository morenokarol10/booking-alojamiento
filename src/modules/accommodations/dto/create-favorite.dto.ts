import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateFavoriteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  alojamientoId!: string;
}
