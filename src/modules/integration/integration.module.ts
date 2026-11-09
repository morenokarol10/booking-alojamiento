import { Module } from '@nestjs/common';
import { IntegrationHealthController } from './integration-health.controller';
import { IntegrationHealthService } from './integration-health.service';
import { IntegrationCatalogController } from './integration-catalog.controller';
import { IntegrationCatalogService } from './integration-catalog.service';
import { IntegrationAuthGuard } from './integration-auth.guard';
import { IntegrationOrderController } from './integration-order.controller';
import { IntegrationOrderService } from './integration-order.service';
import { IntegrationStockSyncService } from './integration-stock-sync.service';
import { IntegrationFeedController } from './integration-feed.controller';
import { IntegrationFeedService } from './integration-feed.service';
import { IntegrationProblemFilter } from './integration-problem.filter';

@Module({
  controllers: [
    IntegrationHealthController,
    IntegrationCatalogController,
    IntegrationOrderController,
    IntegrationFeedController,
  ],
  providers: [
    IntegrationHealthService,
    IntegrationCatalogService,
    IntegrationAuthGuard,
    IntegrationOrderService,
    IntegrationStockSyncService,
    IntegrationFeedService,
    IntegrationProblemFilter,
  ],
  exports: [
    IntegrationHealthService,
    IntegrationCatalogService,
    IntegrationOrderService,
    IntegrationFeedService,
  ],
})
export class IntegrationModule {}
