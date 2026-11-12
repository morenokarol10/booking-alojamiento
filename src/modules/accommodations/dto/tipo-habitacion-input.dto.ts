import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Un tipo de habitación del alojamiento (p. ej. 2 habitaciones dobles). */
export class TipoHabitacionInputDto {
  @ApiPropertyOptional({
    example: 'HABITACION_DOBLE',
    description:
      'Código estable del tipo. Si se omite, se genera a partir del nombre.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  codigo?: string;

  @ApiProperty({ example: 'Habitación doble' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre!: string;

  @ApiProperty({
    example: 2,
    description: 'Cuántas habitaciones de este tipo tiene el alojamiento.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  cantidad!: number;

  @ApiProperty({ example: 2, description: 'Camas en cada habitación.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  camas!: number;

  @ApiPropertyOptional({ example: '2 camas individuales' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  descripcionCamas?: string;

  @ApiProperty({ example: 2, description: 'Huéspedes por habitación.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  capacidadAdultos!: number;

  @ApiProperty({ example: 66, description: 'Precio por habitación y noche.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioNoche!: number;

  @ApiPropertyOptional({ example: 'Dos camas separadas, baño privado.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  descripcion?: string;
}
