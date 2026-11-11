import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
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
  ApiHeader,
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
import { CheckinReservaDto } from './dto/checkin-reserva.dto';
import { CheckOutDto } from './dto/check-out.dto';
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
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'UUID v4 para devolver la misma reserva si el cliente reintenta la solicitud.',
  })
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
  create(
    @Body() dto: CreateReservaDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.reservationsService.create(dto, request.user, idempotencyKey);
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

  @Post(':externalOrderId/checkin')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol admin.' })
  @ApiOperation({
    summary: 'Registrar llegada presencial con Booking Core',
  })
  @ApiOkResponse({
    description: 'Check-in presencial confirmado por Booking Core.',
  })
  @ApiConflictResponse({
    description: 'La reserva no admite check-in o ya tiene otro registro.',
  })
  checkIn(
    @Param('externalOrderId') externalOrderId: string,
    @Body() dto: CheckinReservaDto,
  ) {
    if (!/^ORD-HTL-[A-Z0-9]{3,20}$/.test(externalOrderId)) {
      throw new ConflictException(
        'El identificador externo de la reserva no tiene un formato válido.',
      );
    }
    return this.reservationsService.checkIn(externalOrderId, dto);
  }

  @Post(':reservationId/checkin-local')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiOperation({
    summary: 'Registrar check-in de una reserva del marketplace',
  })
  checkInMarketplace(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: CheckinReservaDto,
  ) {
    return this.reservationsService.checkInMarketplace(reservationId, dto);
  }

  @Post(':reservationId/checkout')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiOperation({
    summary: 'Registrar check-out y comenzar la limpieza de habitaciones',
  })
  checkOut(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: CheckOutDto = new CheckOutDto(),
  ) {
    return this.reservationsService.checkOut(reservationId, dto);
  }

  @Post(':reservationId/limpieza/completar')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiOperation({
    summary: 'Marcar como limpias y liberar las habitaciones asignadas',
  })
  completeRoomCleaning(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ) {
    return this.reservationsService.completeRoomCleaning(reservationId);
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
