import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCustomerController } from './admin-customer.controller';
import { IntegrationHealthController } from './integration-health.controller';
import { IntegrationHealthService } from './integration-health.service';
import { IntegrationCatalogController } from './integration-catalog.controller';
import { IntegrationCatalogService } from './integration-catalog.service';
import { IntegrationAuthGuard } from './integration-auth.guard';
import { IntegrationOrderController } from './integration-order.controller';
import { IntegrationReservationController } from './integration-reservation.controller';
import { IntegrationOrderService } from './integration-order.service';
import { IntegrationStockSyncService } from './integration-stock-sync.service';
import { IntegrationFeedController } from './integration-feed.controller';
import { IntegrationFeedService } from './integration-feed.service';
import { IntegrationProblemFilter } from './integration-problem.filter';
import { IntegrationCustomerController } from './integration-customer.controller';
import { IntegrationCustomerService } from './integration-customer.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminCustomerController,
    IntegrationHealthController,
    IntegrationCatalogController,
    IntegrationOrderController,
    IntegrationReservationController,
    IntegrationFeedController,
    IntegrationCustomerController,
  ],
  providers: [
    IntegrationHealthService,
    IntegrationCatalogService,
    IntegrationAuthGuard,
    IntegrationOrderService,
    IntegrationStockSyncService,
    IntegrationFeedService,
    IntegrationProblemFilter,
    IntegrationCustomerService,
  ],
  exports: [
    IntegrationHealthService,
    IntegrationCatalogService,
    IntegrationOrderService,
    IntegrationFeedService,
  ],
})
export class IntegrationModule {}
