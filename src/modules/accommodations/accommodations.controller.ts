import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AccommodationsService } from './accommodations.service';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CreateAlojamientoDto } from './dto/create-alojamiento.dto';
import { UpdateAlojamientoDto } from './dto/update-alojamiento.dto';
import {
  AlojamientoDeleteResponseDto,
  AlojamientoResponseDto,
  AlojamientosResponseDto,
} from './dto/alojamiento-response.dto';

class AlojamientoFiltersDto {
  @IsOptional()
  @IsString()
  ciudad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioMaximo?: number;
}

@ApiTags('Alojamientos')
@Controller('api/v1/alojamientos')
export class AccommodationsController {
  constructor(private readonly accommodationsService: AccommodationsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar y filtrar alojamientos' })
  @ApiQuery({ name: 'ciudad', required: false, example: 'Quito' })
  @ApiQuery({ name: 'precioMaximo', required: false, example: 120 })
  @ApiOkResponse({
    description: 'Lista de alojamientos.',
    type: AlojamientosResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Los filtros no son válidos.' })
  @ApiResponse({ status: 500, description: 'Error al consultar Supabase.' })
  findAll(@Query() filters: AlojamientoFiltersDto) {
    return this.accommodationsService.findAll(
      filters.ciudad,
      filters.precioMaximo,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar el detalle de un alojamiento' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Alojamiento encontrado.',
    type: AlojamientoResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'El identificador no es un UUID válido.',
  })
  @ApiNotFoundResponse({ description: 'Alojamiento no encontrado.' })
  @ApiResponse({ status: 500, description: 'Error al consultar Supabase.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accommodationsService.findOne(id);
  }

  @Post()
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol admin.' })
  @ApiOperation({ summary: 'Crear un alojamiento (Administración)' })
  @ApiCreatedResponse({
    description: 'Alojamiento creado.',
    type: AlojamientoResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Los datos enviados no son válidos.' })
  @ApiResponse({ status: 500, description: 'Error al guardar en Supabase.' })
  create(@Body() dto: CreateAlojamientoDto) {
    return this.accommodationsService.create(dto);
  }

  @Put(':id')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol admin.' })
  @ApiOperation({ summary: 'Actualizar un alojamiento (Administración)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Alojamiento actualizado.',
    type: AlojamientoResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID o los datos no son válidos.' })
  @ApiNotFoundResponse({ description: 'Alojamiento no encontrado.' })
  @ApiResponse({ status: 500, description: 'Error al guardar en Supabase.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlojamientoDto,
  ) {
    return this.accommodationsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('supabase-jwt')
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere rol admin.' })
  @ApiOperation({ summary: 'Eliminar un alojamiento (Administración)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Alojamiento eliminado.',
    type: AlojamientoDeleteResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'El identificador no es un UUID válido.',
  })
  @ApiNotFoundResponse({ description: 'Alojamiento no encontrado.' })
  @ApiResponse({ status: 409, description: 'Tiene reservas relacionadas.' })
  @ApiResponse({ status: 500, description: 'Error al eliminar en Supabase.' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.accommodationsService.remove(id);
  }
}
