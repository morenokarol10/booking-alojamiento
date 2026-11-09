import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class CheckinReservaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  huespedesReales!: number;
}
