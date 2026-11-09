import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Res,
  UnprocessableEntityException,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { IntegrationHealthService } from './integration-health.service';
import { IntegrationProblemFilter } from './integration-problem.filter';

@Controller('api/v2/alojamientos')
@UseFilters(IntegrationProblemFilter)
export class IntegrationHealthController {
  constructor(
    private readonly integrationHealthService: IntegrationHealthService,
  ) {}

  @Get('health')
  async check(
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (correlationId && !/^[A-Za-z0-9._:-]{4,64}$/.test(correlationId)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'X-Correlation-ID no tiene un formato válido.',
      });
    }
    const validCorrelationId = correlationId ?? randomUUID();
    response.setHeader('X-Correlation-ID', validCorrelationId);

    const health = await this.integrationHealthService.check();
    if (health.status === 'DOWN') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return health;
  }
}
