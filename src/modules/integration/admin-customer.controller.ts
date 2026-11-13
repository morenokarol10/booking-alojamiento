import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  IntegrationCustomerDto,
  IntegrationCustomerQueryDto,
} from './integration-customer.dto';
import { IntegrationCustomerService } from './integration-customer.service';

/** Registro de huéspedes desde el panel (los mismos datos que pide Booking). */
@ApiTags('Administración')
@Controller('api/v1/admin/clientes')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin', 'empleado')
@ApiBearerAuth('supabase-jwt')
export class AdminCustomerController {
  constructor(private readonly customers: IntegrationCustomerService) {}

  @Get()
  @ApiOperation({ summary: 'Listar huéspedes (cédula, nombre y correo)' })
  @ApiOkResponse({ description: 'Huéspedes consultados correctamente.' })
  findAll(@Query() query: IntegrationCustomerQueryDto) {
    return this.customers.findAll(query);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar o actualizar un huésped' })
  @ApiOkResponse({ description: 'Huésped guardado correctamente.' })
  create(@Body() dto: IntegrationCustomerDto) {
    return this.customers.synchronize(dto);
  }
}
