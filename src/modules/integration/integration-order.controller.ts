import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
  UseFilters,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  IntegrationAuthGuard,
  IntegrationScope,
} from './integration-auth.guard';
import {
  IntegrationCancelOrderDto,
  IntegrationOrderCreateDto,
} from './integration-order.dto';
import { CheckOutDto } from '../reservations/dto/check-out.dto';
import { IntegrationOrderService } from './integration-order.service';
import { IntegrationProblemFilter } from './integration-problem.filter';

const ORDER_REF_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ORD-HTL-[A-Z0-9]{3,20}|BK-HOTEL-[A-Z0-9]{3,20}|BKG-[A-Z0-9]{3,20})$/i;

@Controller('api/v2/alojamientos')
@UseFilters(IntegrationProblemFilter)
export class IntegrationOrderController {
  constructor(
    private readonly integrationOrderService: IntegrationOrderService,
  ) {}

  @Post('orders/create')
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
    response.status(201);
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

  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IntegrationAuthGuard)
  @IntegrationScope('alojamientos:cancel')
  async cancel(
    @Param('orderId') orderId: string,
    @Body() dto: IntegrationCancelOrderDto = new IntegrationCancelOrderDto(),
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!ORDER_REF_PATTERN.test(orderId)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail:
          'orderId debe ser UUID, external_order_id o código de reserva reconocido.',
      });
    }
    const correlation = this.correlationId(correlationId);
    response.setHeader('X-Correlation-ID', correlation);
    const result = await this.integrationOrderService.cancel(
      orderId,
      dto,
      idempotencyKey,
      correlation,
    );
    if (result.replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
    }
    return result.body;
  }

  @Post('orders/:orderId/checkout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IntegrationAuthGuard)
  @IntegrationScope('alojamientos:checkin')
  async checkOut(
    @Param('orderId') orderId: string,
    @Body() dto: CheckOutDto = new CheckOutDto(),
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!ORDER_REF_PATTERN.test(orderId)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail:
          'orderId debe ser UUID, external_order_id o código de reserva reconocido.',
      });
    }
    const correlation = this.correlationId(correlationId);
    response.setHeader('X-Correlation-ID', correlation);
    return this.integrationOrderService.checkOut(orderId, dto, correlation);
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
