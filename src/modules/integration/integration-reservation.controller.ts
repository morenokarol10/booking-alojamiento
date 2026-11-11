import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseFilters,
  UseGuards,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  IntegrationAuthGuard,
  IntegrationScope,
} from './integration-auth.guard';
import { IntegrationOrderCreateDto } from './integration-order.dto';
import { IntegrationOrderService } from './integration-order.service';
import { IntegrationProblemFilter } from './integration-problem.filter';

@Controller(['api/v2/reservas', 'api/v2/alojamientos/reservas'])
@UseFilters(IntegrationProblemFilter)
export class IntegrationReservationController {
  constructor(
    private readonly integrationOrderService: IntegrationOrderService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegrationAuthGuard)
  @IntegrationScope('alojamientos:book')
  async create(
    @Body() dto: IntegrationOrderCreateDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const correlation = this.correlationId(correlationId);
    response.setHeader('X-Correlation-ID', correlation);
    const result = await this.integrationOrderService.create(
      dto,
      idempotencyKey,
      correlation,
    );
    const orderId = String(result.body.orderId);
    response.setHeader(
      'Location',
      `/api/v2/alojamientos/orders/${encodeURIComponent(orderId)}`,
    );
    if (result.replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
    }
    return result.body;
  }

  private correlationId(value: string | undefined): string {
    if (value && !/^[A-Za-z0-9._:-]{4,64}$/.test(value)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'X-Correlation-ID no tiene un formato válido.',
      });
    }
    return value ?? randomUUID();
  }
}
