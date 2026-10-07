import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateReservaDto } from './dto/create-reserva.dto';
import {
  ReservaResponseDto,
  ReservasResponseDto,
} from './dto/reserva-response.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('Reservas')
@Controller('api/v1/reservas')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una reserva y registrar su evento' })
  @ApiCreatedResponse({
    description: 'Reserva creada y evento ReservaRealizadaEvent registrado.',
    type: ReservaResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, fechas ocupadas o alojamiento no disponible.',
  })
  @ApiNotFoundResponse({ description: 'Alojamiento no encontrado.' })
  @ApiResponse({ status: 500, description: 'Error al crear reserva o evento.' })
  create(@Body() dto: CreateReservaDto) {
    return this.reservationsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Consultar reservas (Administración)' })
  @ApiOkResponse({
    description: 'Lista de reservas con su alojamiento.',
    type: ReservasResponseDto,
  })
  @ApiResponse({ status: 500, description: 'Error al consultar Supabase.' })
  findAll() {
    return this.reservationsService.findAll();
  }
}
