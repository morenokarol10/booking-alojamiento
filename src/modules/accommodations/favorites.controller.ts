import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('Favoritos')
@Controller('api/v1/favoritos')
@UseGuards(SupabaseAuthGuard)
@ApiBearerAuth('supabase-jwt')
@ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar favoritos del cliente autenticado' })
  @ApiOkResponse({ description: 'IDs de alojamientos favoritos.' })
  findMine(@Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.favoritesService.findMine(request.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Guardar un alojamiento como favorito' })
  @ApiCreatedResponse({ description: 'Favorito guardado.' })
  @ApiNotFoundResponse({ description: 'Alojamiento no encontrado.' })
  create(@Body() dto: CreateFavoriteDto, @Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.favoritesService.add(request.user.id, dto.alojamientoId);
  }

  @Delete(':alojamientoId')
  @ApiOperation({ summary: 'Eliminar un alojamiento de favoritos' })
  @ApiOkResponse({ description: 'Favorito eliminado.' })
  @ApiNotFoundResponse({ description: 'Favorito no encontrado.' })
  remove(
    @Param('alojamientoId', ParseUUIDPipe) accommodationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.favoritesService.remove(request.user.id, accommodationId);
  }
}
