import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@ApiTags('Administración')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth('supabase-jwt')
@ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
@ApiForbiddenResponse({ description: 'Se requiere rol admin.' })
@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('eventos')
  @ApiOperation({ summary: 'Consultar eventos registrados para monitoreo EDA' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({
    description: 'Eventos ordenados del más reciente al más antiguo.',
  })
  @ApiResponse({ status: 500, description: 'Error al consultar eventos.' })
  findEvents(@Query('limit') limit?: string) {
    return this.adminService.findEvents(limit);
  }
}
