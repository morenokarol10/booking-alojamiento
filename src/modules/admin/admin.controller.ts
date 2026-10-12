import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdateManagedUserRoleDto } from './dto/update-managed-user-role.dto';

@ApiTags('Administración')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth('supabase-jwt')
@ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
@ApiForbiddenResponse({ description: 'Se requiere rol admin.' })
@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('usuarios')
  @ApiOperation({ summary: 'Listar cuentas y roles' })
  @ApiOkResponse({ description: 'Cuentas consultadas correctamente.' })
  @ApiResponse({ status: 500, description: 'Error al consultar cuentas.' })
  findUsers() {
    return this.adminService.findUsers();
  }

  @Post('usuarios')
  @ApiOperation({ summary: 'Crear una cuenta activa y asignar su rol' })
  @ApiCreatedResponse({ description: 'Cuenta creada correctamente.' })
  @ApiResponse({ status: 400, description: 'Datos o correo no válidos.' })
  createUser(@Body() dto: CreateManagedUserDto) {
    return this.adminService.createUser(dto);
  }

  @Put('usuarios/:id/rol')
  @ApiOperation({ summary: 'Actualizar el rol de una cuenta' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Rol actualizado correctamente.' })
  @ApiResponse({ status: 400, description: 'Cuenta o rol no válidos.' })
  @ApiForbiddenResponse({
    description: 'No se puede modificar el rol de la propia cuenta.',
  })
  updateUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagedUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.adminService.updateUserRole(
      id,
      dto.role,
      request.user.id,
    );
  }

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
