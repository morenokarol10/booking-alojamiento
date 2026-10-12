import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { UserRole } from '../../auth/auth.types';

export class UpdateManagedUserRoleDto {
  @ApiProperty({ enum: ['admin', 'empleado', 'cliente'] })
  @IsIn(['admin', 'empleado', 'cliente'])
  role!: UserRole;
}
