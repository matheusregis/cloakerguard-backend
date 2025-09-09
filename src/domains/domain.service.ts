import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Domain, DomainDocument, EDomainStatus } from './schemas/domain.schema';
import { CreateDNSRecordDto } from './dto/create-dns.dto';
import { UpdateDNSRecordDto } from './dto/update-dns.dto';
import {
  CloudflareService,
  CloudflareDNSResult,
} from '../domains/cloudflare/cloudflare.service';
import * as dns from 'node:dns/promises';

@Injectable()
export class DomainService {
  private readonly logger = new Logger(DomainService.name);

  private readonly zoneId = process.env.CLOUDFLARE_ZONE_ID!;
  private readonly EDGE_ORIGIN =
    process.env.CLOAKER_EDGE_ORIGIN || 'edge.cloakerguard.com.br';
  private readonly HEALTH_SCHEME = process.env.HEALTHCHECK_SCHEME || 'https';
  private readonly HEALTH_PATH =
    process.env.HEALTHCHECK_PATH || '/__edge-check';

  constructor(
    @InjectModel(Domain.name)
    private readonly domainModel: Model<DomainDocument>,
    private readonly cloudflare: CloudflareService,
  ) {}

  private ensureZone() {
    if (!this.zoneId) throw new Error('CLOUDFLARE_ZONE_ID não configurada.');
  }

  private n(v?: string) {
    return (v || '').trim().toLowerCase().replace(/\.$/, '');
  }

  /** <slug>-<userId>.cloakerguard.com.br */
  private computeSubdomain(externalFqdn: string, userId: string) {
    const host = this.n(externalFqdn)
      .split('.')[0]
      .replace(/[^a-z0-9-]/g, '');
    const label = `${host}-${userId}`.replace(/[^a-z0-9-]/g, '');
    return `${label}.cloakerguard.com.br`;
  }

  // -------- CRUD --------

  async createDomain(dto: CreateDNSRecordDto, userId: string) {
    this.ensureZone();

    const externalFqdn = this.n(dto.name);
    const subdomain = this.computeSubdomain(externalFqdn, userId);
    const subLabel = subdomain.replace('.cloakerguard.com.br', '');

    // 1) CNAME interno -> EDGE
    const dnsRes: CloudflareDNSResult = await this.cloudflare.createDNSRecord(
      subLabel,
      'CNAME',
      this.EDGE_ORIGIN,
      { zoneId: this.zoneId, proxied: false },
    );

    // 2) Cria documento
    const domain = await this.domainModel.create({
      name: externalFqdn,
      type: 'CNAME',
      content: this.EDGE_ORIGIN,
      whiteUrl: dto.whiteUrl,
      blackUrl: dto.blackUrl,
      proxied: dnsRes?.proxiable ?? false,
      subdomain,
      userId,
      status: EDomainStatus.PENDING,
      createdAt: new Date(),
    });

    return this.domainModel.findById(domain._id);
  }

  async updateDomain(
    id: string,
    dto: Partial<UpdateDNSRecordDto>,
  ): Promise<DomainDocument> {
    const domain = await this.domainModel.findById(id).exec();
    if (!domain) throw new NotFoundException('Domain not found');
    this.ensureZone();

    const rec = await this.cloudflare.getDNSRecordId(
      (domain as any).subdomain,
      {
        zoneId: this.zoneId,
        type: 'CNAME',
      },
    );
    if (!rec)
      throw new NotFoundException('Registro DNS não encontrado no Cloudflare.');

    await this.cloudflare.updateDNSRecordById(this.zoneId, rec.id, {
      type: 'CNAME',
      content: this.EDGE_ORIGIN,
      name: (domain as any).subdomain,
      proxied: false,
    });

    const updated = await this.domainModel
      .findByIdAndUpdate(
        id,
        {
          name: dto.name ?? domain.name,
          whiteUrl: dto.whiteUrl ?? domain.whiteUrl,
          blackUrl: dto.blackUrl ?? domain.blackUrl,
        },
        { new: true },
      )
      .exec();

    if (!updated) throw new NotFoundException('Domain not found after update');
    return updated;
  }

  async deleteDomain(id: string): Promise<{ deleted: true }> {
    const domain = await this.domainModel.findById(id).exec();
    if (!domain) throw new NotFoundException('Domain not found');
    this.ensureZone();

    const rec = await this.cloudflare.getDNSRecordId(
      (domain as any).subdomain,
      {
        zoneId: this.zoneId,
        type: 'CNAME',
      },
    );
    if (rec) await this.cloudflare.deleteDNSRecordById(this.zoneId, rec.id);

    await this.domainModel.findByIdAndDelete(id).exec();
    return { deleted: true };
  }

  // -------- Queries --------

  async findAllByUser(userId: string) {
    return this.domainModel.find({ userId });
  }

  async findOne(id: string) {
    return this.domainModel.findById(id);
  }

  async findByClient(clientId: string) {
    return this.domainModel.find({ userId: clientId });
  }

  async findBySubdomain(subdomain: string) {
    return this.domainModel.findOne({ subdomain });
  }

  async findByHost(host: string) {
    const h = this.n(host);
    return this.domainModel.findOne({
      $or: [
        { name: h }, // domínio externo do cliente
        { subdomain: h }, // subdomínio interno <slug>-<userId>.cloakerguard.com.br
      ],
    });
  }

  async countActiveByUser(userId: string) {
    return this.domainModel
      .countDocuments({ userId, status: EDomainStatus.ACTIVE })
      .exec();
  }

  // -------- Helpers --------

  private async resolveCNAMEs(host: string): Promise<string[]> {
    const fqdn = this.n(host);

    // 1. Tenta direto o CNAME
    try {
      const cn = await dns.resolveCname(fqdn);
      if (cn.length) return cn.map((v) => this.n(v));
    } catch (e: any) {
      if (e.code !== 'ENODATA' && e.code !== 'ENOTFOUND') {
        this.logger.warn(`[resolveCNAMEs] resolveCname falhou: ${e.message}`);
      }
    }

    // 2. Fallback: resolveAny
    try {
      const any = await dns.resolveAny(fqdn);
      const cname = any
        .filter((r: any) => r?.type === 'CNAME' && r?.value)
        .map((r: any) => this.n(r.value));

      if (cname.length) return cname;

      // 🔥 se só tiver A/AAAA → o DNS já resolveu internamente
      const hasA = any.some((r: any) => r?.type === 'A' || r?.type === 'AAAA');
      if (hasA) return ['resolved-to-A'];
    } catch (e: any) {
      if (e.code !== 'ENODATA' && e.code !== 'ENOTFOUND') {
        this.logger.warn(`[resolveCNAMEs] resolveAny falhou: ${e.message}`);
      }
    }

    return [];
  }

  private async httpHealth(
    fqdn: string,
  ): Promise<{ ok: boolean; status?: number }> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      const url = `${this.HEALTH_SCHEME}://${fqdn}${this.HEALTH_PATH}`;
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(t);

      if (res.ok || (res.status >= 300 && res.status < 400)) {
        return { ok: true, status: res.status };
      }

      // fallback GET
      const controller2 = new AbortController();
      const t2 = setTimeout(() => controller2.abort(), 4000);
      const res2 = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller2.signal,
      });
      clearTimeout(t2);

      const ok = res2.ok || (res2.status >= 300 && res2.status < 400);
      return { ok, status: res2.status };
    } catch {
      return { ok: false };
    }
  }

  // -------- Status --------

  async checkStatus(domainId: string) {
    const domain = await this.domainModel.findById(domainId).exec();
    if (!domain) throw new NotFoundException('Domain not found');

    let status = EDomainStatus.PENDING;
    let reason = '';

    const expected = this.n(this.EDGE_ORIGIN);
    const cnames = await this.resolveCNAMEs(domain.name);

    if (cnames.length === 0) {
      status = EDomainStatus.PENDING;
      reason = 'Nenhum registro DNS encontrado.';
    } else if (cnames.includes('resolved-to-A')) {
      const health = await this.httpHealth(domain.name);
      if (health.ok) {
        status = EDomainStatus.ACTIVE;
      } else {
        status = EDomainStatus.PROPAGATING;
        reason =
          'DNS resolvido para A/AAAA (sem CNAME visível), aguardando propagação/HTTP.';
      }
    } else if (!cnames.includes(expected)) {
      status = EDomainStatus.ERROR;
      reason = `CNAME aponta para "${cnames[0]}", esperado "${expected}".`;
    } else {
      const health = await this.httpHealth(domain.name);
      if (health.ok) {
        status = EDomainStatus.ACTIVE;
      } else {
        status = EDomainStatus.PROPAGATING;
        reason = 'CNAME correto, aguardando propagação/HTTP.';
      }
    }

    domain.status = status;
    (domain as any).lastReason = reason || undefined;
    (domain as any).lastCheckedAt = new Date();
    await domain.save();

    return {
      status,
      reason: (domain as any).lastReason,
      checkedAt: (domain as any).lastCheckedAt,
    };
  }
}
