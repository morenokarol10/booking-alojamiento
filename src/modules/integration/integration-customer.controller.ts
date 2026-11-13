import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IntegrationAuthGuard,
  IntegrationScope,
} from './integration-auth.guard';
import {
  IntegrationCustomerDto,
  IntegrationCustomerQueryDto,
} from './integration-customer.dto';
import { IntegrationCustomerService } from './integration-customer.service';
import { IntegrationProblemFilter } from './integration-problem.filter';

@ApiTags('Integración de huéspedes')
@Controller('api/v2/clientes')
@UseGuards(IntegrationAuthGuard)
@UseFilters(IntegrationProblemFilter)
export class IntegrationCustomerController {
  constructor(private readonly customers: IntegrationCustomerService) {}

  @Get()
  @IntegrationScope('alojamientos:read')
  @ApiOperation({
    summary:
      'Listar o buscar huéspedes sincronizados (por identificacion/cedula o email)',
  })
  @ApiOkResponse({ description: 'Huéspedes consultados correctamente.' })
  findAll(@Query() query: IntegrationCustomerQueryDto) {
    return this.customers.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @IntegrationScope('alojamientos:book')
  @ApiOperation({
    summary: 'Crear o actualizar un huésped sincronizado por correo',
  })
  @ApiOkResponse({ description: 'Huésped sincronizado correctamente.' })
  synchronize(@Body() dto: IntegrationCustomerDto) {
    return this.customers.synchronize(dto);
  }
}
