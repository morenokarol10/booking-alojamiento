import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

@Catch()
export class IntegrationProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(IntegrationProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const correlationId = this.getCorrelationId(request);
    response.setHeader('X-Correlation-ID', correlationId);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const detail = this.detail(payload);
    const code = this.code(payload, status);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled integration error (${correlationId}): ${
          exception instanceof Error ? exception.message : 'Unknown error'
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: this.title(status),
        status,
        detail,
        instance: request.originalUrl,
        code,
        correlation_id: correlationId,
      });
  }

  private detail(payload: unknown): string {
    if (typeof payload === 'string') return payload;
    if (!isRecord(payload)) return 'Ocurrió un error al procesar la solicitud.';
    if (typeof payload.detail === 'string') return payload.detail;
    if (typeof payload.message === 'string') return payload.message;
    if (Array.isArray(payload.message)) {
      return payload.message
        .filter((message): message is string => typeof message === 'string')
        .join('; ');
    }
    return 'Ocurrió un error al procesar la solicitud.';
  }

  private code(payload: unknown, status: number): string {
    if (isRecord(payload) && typeof payload.code === 'string') {
      return payload.code;
    }
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.CONFLICT) return 'CONFLICT';
    if (status === HttpStatus.UNPROCESSABLE_ENTITY) return 'VALIDATION_FAILED';
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'PROVIDER_DISABLED';
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) return 'INTERNAL_ERROR';
    return 'VALIDATION_FAILED';
  }

  private title(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return 'Bad Request';
    if (status === HttpStatus.UNAUTHORIZED) return 'Unauthorized';
    if (status === HttpStatus.FORBIDDEN) return 'Forbidden';
    if (status === HttpStatus.NOT_FOUND) return 'Not Found';
    if (status === HttpStatus.CONFLICT) return 'Conflict';
    if (status === HttpStatus.UNPROCESSABLE_ENTITY)
      return 'Unprocessable Entity';
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'Service Unavailable';
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR)
      return 'Internal Server Error';
    return 'Request Error';
  }

  private getCorrelationId(request: Request): string {
    const header = request.headers['x-correlation-id'];
    return typeof header === 'string' && /^[A-Za-z0-9._:-]{4,64}$/.test(header)
      ? header
      : randomUUID();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
