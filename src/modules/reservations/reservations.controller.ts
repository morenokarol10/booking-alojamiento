import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { CancelReservaDto } from './dto/cancel-reserva.dto';
import {
  CancelReservaResponseDto,
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
  @ApiOperation({ summary: 'Crear una reserva para el cliente autenticado' })
  @ApiCreatedResponse({
    description:
      'Reserva creada. Si falla la bitácora de eventos, se responde con una advertencia sin ocultar que la reserva quedó guardada.',
    type: ReservaResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o el alojamiento excede su capacidad.',
  })
  @ApiConflictResponse({
    description:
      'Ya no hay habitaciones disponibles para el alojamiento en las fechas solicitadas.',
  })
  @ApiNotFoundResponse({ description: 'Alojamiento no encontrado.' })
  @ApiResponse({ status: 500, description: 'Error al crear la reserva.' })
  create(@Body() dto: CreateReservaDto, @Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.reservationsService.create(dto, request.user);
  }

  @Post(':id/cancelar')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('cliente')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol cliente.' })
  @ApiOperation({
    summary: 'Cancelar una reserva futura del cliente autenticado',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Reserva cancelada; devolución simulada.',
    type: CancelReservaResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Se requiere la confirmación de pago simulado.',
  })
  @ApiNotFoundResponse({ description: 'Reserva no encontrada.' })
  @ApiConflictResponse({
    description: 'La reserva no está confirmada, ya fue cancelada o ya inició.',
  })
  @ApiResponse({ status: 500, description: 'Error al cancelar la reserva.' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReservaDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.reservationsService.cancel(id, dto, request.user);
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
