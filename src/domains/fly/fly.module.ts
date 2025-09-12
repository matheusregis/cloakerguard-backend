// src/domains/fly/fly.module.ts
import { Module } from '@nestjs/common';
import { FlyCertificatesService } from './fly.service';

@Module({
  providers: [FlyCertificatesService],
  exports: [FlyCertificatesService],
})
export class FlyModule {}
