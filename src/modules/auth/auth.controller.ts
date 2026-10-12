import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
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
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SavePaymentMethodDto } from './dto/save-payment-method.dto';

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

  @Put('me')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('supabase-jwt')
  @ApiOperation({ summary: 'Actualizar el perfil del usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Perfil actualizado.' })
  @ApiResponse({ status: 400, description: 'Datos de perfil no válidos.' })
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  updateMe(
    @Body() dto: UpdateProfileDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.authService.updateProfile(request.user, dto);
  }

  @Put('me/payment-method')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('supabase-jwt')
  @ApiOperation({
    summary: 'Guardar la referencia enmascarada de una tarjeta de prueba',
    description:
      'Solo guarda marca y últimos cuatro dígitos; nunca recibe número completo ni CVV.',
  })
  @ApiResponse({ status: 200, description: 'Referencia guardada.' })
  @ApiResponse({ status: 400, description: 'Referencia no válida.' })
  @ApiUnauthorizedResponse({ description: 'Token ausente o no válido.' })
  savePaymentMethod(
    @Body() dto: SavePaymentMethodDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new UnauthorizedException('La sesión no está autenticada.');
    }
    return this.authService.savePaymentMethod(request.user, dto);
  }
}
