import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { RoomCleaningScheduler } from './room-cleaning.scheduler';
import { BookingCheckinRetryScheduler } from './booking-checkin-retry.scheduler';

@Module({
  imports: [AuthModule],
  controllers: [ReservationsController],
  providers: [
    ReservationsService,
    RoomCleaningScheduler,
    BookingCheckinRetryScheduler,
  ],
  exports: [ReservationsService],
})
export class ReservationsModule {}
