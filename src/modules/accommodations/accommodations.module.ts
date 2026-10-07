import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccommodationsController } from './accommodations.controller';
import { AccommodationsService } from './accommodations.service';

@Module({
  imports: [AuthModule],
  controllers: [AccommodationsController],
  providers: [AccommodationsService],
  exports: [AccommodationsService],
})
export class AccommodationsModule {}
