import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Res,
  UnprocessableEntityException,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  IntegrationAuthGuard,
  IntegrationScope,
} from './integration-auth.guard';
import {
  IntegrationEventFeedQueryDto,
  IntegrationInventoryQueryDto,
} from './integration-feed.dto';
import { IntegrationFeedService } from './integration-feed.service';
import { IntegrationProblemFilter } from './integration-problem.filter';

@Controller('api/v2/alojamientos')
@UseFilters(IntegrationProblemFilter)
export class IntegrationFeedController {
  constructor(
    private readonly integrationFeedService: IntegrationFeedService,
  ) {}

  @Get('eventos')
  @UseGuards(IntegrationAuthGuard)
  @IntegrationScope('alojamientos:inventory')
  events(
    @Query() query: IntegrationEventFeedQueryDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('X-Correlation-ID', this.correlationId(correlationId));
    return this.integrationFeedService.events(query);
  }

  @Get(':id/inventario')
  @UseGuards(IntegrationAuthGuard)
  @IntegrationScope('alojamientos:inventory')
  inventory(
    @Param('id') accommodationId: string,
    @Query() query: IntegrationInventoryQueryDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(accommodationId)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'El identificador del alojamiento no tiene un formato válido.',
      });
    }
    response.setHeader('X-Correlation-ID', this.correlationId(correlationId));
    return this.integrationFeedService.inventory(accommodationId, query);
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
