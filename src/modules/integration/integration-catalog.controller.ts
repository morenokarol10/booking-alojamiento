import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  IntegrationAvailabilityDto,
  IntegrationCatalogQueryDto,
  IntegrationSearchDto,
} from './integration-catalog.dto';
import { IntegrationCatalogService } from './integration-catalog.service';
import { IntegrationProblemFilter } from './integration-problem.filter';

@Controller('api/v2/alojamientos')
@UseFilters(IntegrationProblemFilter)
export class IntegrationCatalogController {
  constructor(
    private readonly integrationCatalogService: IntegrationCatalogService,
  ) {}

  @Get()
  async list(
    @Query() query: IntegrationCatalogQueryDto,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('X-Correlation-ID', this.correlationId(correlationId));
    const result = await this.integrationCatalogService.list(query);
    response.setHeader('ETag', result.etag);
    if (
      ifNoneMatch
        ?.split(',')
        .some((tag) => tag.trim() === result.etag || tag.trim() === '*')
    ) {
      response.status(304);
      return;
    }
    return result.body;
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(
    @Body() dto: IntegrationSearchDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('X-Correlation-ID', this.correlationId(correlationId));
    return this.integrationCatalogService.search(dto);
  }

  @Post('availability')
  @HttpCode(HttpStatus.OK)
  quote(
    @Body() dto: IntegrationAvailabilityDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('X-Correlation-ID', this.correlationId(correlationId));
    return this.integrationCatalogService.quote(dto);
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
