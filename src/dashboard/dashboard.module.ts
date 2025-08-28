import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Access, AccessSchema } from './schemas/access.schema';
import { MongooseModule } from '@nestjs/mongoose';
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  imports: [
    MongooseModule.forFeature([{ name: Access.name, schema: AccessSchema }]),
  ],
})
export class DashboardModule {}
