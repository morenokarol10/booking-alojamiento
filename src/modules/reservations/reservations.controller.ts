import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateReservaDto } from './dto/create-reserva.dto';
import {
  ReservaResponseDto,
  ReservasResponseDto,
} from './dto/reserva-response.dto';
import { ReservationsService } from './reservations.service';
import { Roles } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@ApiTags('Reservas')
@Controller('api/v1/reservas')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('cliente')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol cliente.' })
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
  create(@Body() dto: CreateReservaDto, @Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.reservationsService.create(dto, request.user);
  }

  @Get()
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol admin.' })
  @ApiOperation({ summary: 'Consultar reservas (Administración)' })
  @ApiOkResponse({
    description: 'Lista de reservas con su alojamiento.',
    type: ReservasResponseDto,
  })
  @ApiResponse({ status: 500, description: 'Error al consultar Supabase.' })
  findAll() {
    return this.reservationsService.findAll();
  }

  @Get('mis-reservas')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('cliente')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol cliente.' })
  @ApiOperation({ summary: 'Consultar las reservas del cliente autenticado' })
  @ApiOkResponse({
    description:
      'Reservas pertenecientes exclusivamente al usuario autenticado.',
    type: ReservasResponseDto,
  })
  @ApiResponse({ status: 500, description: 'Error al consultar Supabase.' })
  findMine(@Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.reservationsService.findMine(request.user);
  }
}
