// src/domains/domain.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DomainService } from './domain.service';
import { DomainController } from './domain.controller';
import { Domain, DomainSchema } from './schemas/domain.schema';
import { CloudflareModule } from './cloudflare/cloudflare.module';
import { CloudflareService } from './cloudflare/cloudflare.service';
import { FlyModule } from './fly/fly.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Domain.name, schema: DomainSchema }]),
    CloudflareModule,
    FlyModule, // 🔽 integração com GraphQL do Fly
  ],
  controllers: [DomainController],
  providers: [DomainService, CloudflareService],
  exports: [DomainService],
})
export class DomainModule {}
