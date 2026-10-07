import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('Autenticación')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Registrar una cuenta cliente',
    description:
      'El rol cliente se asigna en el servidor; el cliente no puede elegir el rol.',
  })
  @ApiCreatedResponse({ description: 'Cuenta cliente creada.' })
  @ApiResponse({ status: 400, description: 'No se pudo crear la cuenta.' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión con Supabase Auth' })
  @ApiResponse({ status: 200, description: 'Sesión iniciada.' })
  @ApiResponse({ status: 401, description: 'Credenciales incorrectas.' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('supabase-jwt')
  @ApiOperation({ summary: 'Consultar el usuario autenticado y su rol' })
  @ApiResponse({ status: 200, description: 'Perfil de usuario autenticado.' })
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  me(@Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.authService.getProfile(request.user);
  }
}
