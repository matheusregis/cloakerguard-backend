import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DomainService } from './domain.service';
import { DomainController } from './domain.controller';
import { Domain, DomainSchema } from './schemas/domain.schema';
import { CloudflareModule } from './cloudflare/cloudflare.module';
import { CloudflareService } from './cloudflare/cloudflare.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Domain.name, schema: DomainSchema }]),
    CloudflareModule,
  ],
  controllers: [DomainController],
  providers: [DomainService, CloudflareService],
  exports: [DomainService],
})
export class DomainModule {}
