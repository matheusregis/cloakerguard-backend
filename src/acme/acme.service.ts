// src/acme/acme.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AcmeChallenge, AcmeChallengeDocument } from './acme-challenge.schema';
import { CloudflareService } from '../domains/cloudflare/cloudflare.service';

@Injectable()
export class AcmeService {
  constructor(
    @InjectModel(AcmeChallenge.name)
    private readonly model: Model<AcmeChallengeDocument>,
    private readonly cf: CloudflareService,
  ) {}

  async upsertToken(host: string, token: string, body: string, cfId?: string) {
    await this.model.updateOne(
      { host, token },
      {
        $set: {
          body,
          cfId,
          expireAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        },
      },
      { upsert: true },
    );
  }

  async getBody(host: string, token: string): Promise<string | null> {
    const rec = await this.model.findOne({ host, token }).lean();
    return rec?.body ?? null;
  }

  async removeByCfId(cfId: string) {
    await this.model.deleteMany({ cfId });
  }

  // === fluxo SaaS ===
  async createCustomerHostname(hostname: string, origin?: string) {
    const res = await this.cf.createCustomHostnameHTTP(hostname, { origin });
    const vr = res?.ssl?.validation_records?.find(
      (v) => v.http_url && v.http_body,
    );
    if (vr?.http_url && vr.http_body) {
      const token = vr.http_url.split('/').pop()!;
      await this.upsertToken(
        hostname.toLowerCase(),
        token,
        vr.http_body,
        res.id,
      );
    }
    return { id: res.id, hostname: res.hostname, sslStatus: res.ssl?.status };
  }
}
