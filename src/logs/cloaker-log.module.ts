import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CloakerLogService } from './cloaker-log.service';
import { CloakerLog, CloakerLogSchema } from './schemas/cloaker-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CloakerLog.name, schema: CloakerLogSchema },
    ]),
  ],
  providers: [CloakerLogService],
  exports: [CloakerLogService],
})
export class CloakerLogModule {}
