import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import type { UserRole } from '../auth/auth.types';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';

@Injectable()
export class AdminService {
  private readonly maxUserPages = 100;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findUsers() {
    const users: User[] = [];
    for (let page = 1; page <= this.maxUserPages; page += 1) {
      const { data, error } = await this.supabase.auth.admin.listUsers({
        page,
        perPage: 100,
      });
      if (error) {
        throw new InternalServerErrorException({
          statusCode: 500,
          message: 'No se pudieron consultar las cuentas.',
          error: error.message,
        });
      }
      users.push(...data.users);
      if (data.users.length < 100) {
        return {
          data: users.map((user) => this.toManagedUser(user)),
          message: 'Cuentas consultadas correctamente.',
        };
      }
    }
    throw new InternalServerErrorException(
      'El número de cuentas supera el límite de consulta administrativa.',
    );
  }

  async createUser(dto: CreateManagedUserDto) {
    const { data, error } = await this.supabase.auth.admin.createUser({
      email: dto.email.trim(),
      password: dto.password,
      email_confirm: true,
      app_metadata: { role: dto.role },
      user_metadata: {
        full_name: dto.fullName.trim(),
        phone: dto.phone.trim(),
      },
    });
    if (error) {
      throw new BadRequestException(
        `No se pudo crear la cuenta: ${error.message}`,
      );
    }
    if (!data.user) {
      throw new InternalServerErrorException(
        'Supabase no devolvió la cuenta creada.',
      );
    }
    return {
      data: this.toManagedUser(data.user),
      message: 'Cuenta creada y activada correctamente.',
    };
  }

  async updateUserRole(userId: string, role: UserRole, actorId: string) {
    if (userId === actorId) {
      throw new ForbiddenException(
        'No puedes cambiar el rol de tu propia cuenta.',
      );
    }

    const { data: existing, error: lookupError } =
      await this.supabase.auth.admin.getUserById(userId);
    if (lookupError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo consultar la cuenta.',
        error: lookupError.message,
      });
    }
    if (!existing.user) {
      throw new BadRequestException('No existe la cuenta indicada.');
    }
    const { data, error } = await this.supabase.auth.admin.updateUserById(
      userId,
      {
        app_metadata: {
          ...existing.user.app_metadata,
          role,
        },
      },
    );
    if (error) {
      throw new BadRequestException(
        `No se pudo actualizar el rol: ${error.message}`,
      );
    }
    if (!data.user) {
      throw new InternalServerErrorException(
        'Supabase no devolvió la cuenta actualizada.',
      );
    }
    return {
      data: this.toManagedUser(data.user),
      message: 'Rol actualizado correctamente.',
    };
  }

  async findEvents(limitValue?: string) {
    const limit = limitValue === undefined ? 50 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100.');
    }

    const { data, error } = await this.supabase
      .from('eventos_log')
      .select('id, tipo_evento, payload, creado_en')
      .order('creado_en', { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudieron consultar los eventos registrados.',
        error: error.message,
      });
    }

    return {
      data: data.map((row: Record<string, unknown>) => ({
        id: row.id,
        tipoEvento: row.tipo_evento,
        payload: row.payload,
        creadoEn: row.creado_en,
      })),
      message: 'Eventos consultados correctamente.',
    };
  }

  private toManagedUser(user: {
    id: string;
    email?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    created_at?: string;
    email_confirmed_at?: string;
  }) {
    const role = user.app_metadata?.role;
    return {
      id: user.id,
      email: user.email ?? '',
      fullName: this.metadataString(user.user_metadata, 'full_name'),
      phone: this.metadataString(user.user_metadata, 'phone'),
      role:
        role === 'admin' || role === 'empleado'
          ? role
          : ('cliente' as const),
      createdAt: user.created_at ?? null,
      emailConfirmed: Boolean(user.email_confirmed_at),
    };
  }

  private metadataString(
    metadata: Record<string, unknown> | undefined,
    key: string,
  ): string {
    const value = metadata?.[key];
    return typeof value === 'string' ? value : '';
  }
}
