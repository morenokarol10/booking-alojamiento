import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccommodationsController } from './accommodations.controller';
import { AccommodationsService } from './accommodations.service';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

@Module({
  imports: [AuthModule],
  controllers: [AccommodationsController, FavoritesController],
  providers: [AccommodationsService, FavoritesService],
  exports: [AccommodationsService],
})
export class AccommodationsModule {}
