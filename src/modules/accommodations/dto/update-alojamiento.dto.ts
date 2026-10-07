import { PartialType } from '@nestjs/swagger';
import { CreateAlojamientoDto } from './create-alojamiento.dto';

export class UpdateAlojamientoDto extends PartialType(CreateAlojamientoDto) {}
