import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';

@ApiTags('Administración')
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
