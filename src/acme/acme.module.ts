import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AcmeChallenge, AcmeChallengeSchema } from './acme-challenge.schema';
import { AcmeService } from './acme.service.js';
import { AcmeController } from './acme.controller';
import { CloudflareService } from '../domains/cloudflare/cloudflare.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AcmeChallenge.name, schema: AcmeChallengeSchema },
    ]),
  ],
  providers: [AcmeService, CloudflareService],
  controllers: [AcmeController],
  exports: [AcmeService],
})
export class AcmeModule {}
