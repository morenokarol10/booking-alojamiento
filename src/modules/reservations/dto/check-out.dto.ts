import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class CheckOutMinibarItemDto {
  @IsString()
  @MaxLength(80)
  item!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  cantidad?: number;

  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/)
  precio!: string;
}

export class CheckOutDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckOutMinibarItemDto)
  consumosMinibar?: CheckOutMinibarItemDto[];

  @IsOptional()
  @IsIn(['TARJETA_REGISTRADA', 'EFECTIVO', 'CARGO_A_RESERVA'])
  metodoPagoConsumos?: string;
}
