// src/domains/domain.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Domain, DomainDocument, EDomainStatus } from './schemas/domain.schema';
import { CreateDNSRecordDto } from './dto/create-dns.dto';
import { UpdateDNSRecordDto } from './dto/update-dns.dto';
import {
  CloudflareService,
  CloudflareDNSResult,
  CfCustomHostname,
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
      subLabel, // dentro da SUA zona
      'CNAME',
      this.EDGE_ORIGIN,
      { zoneId: this.zoneId, proxied: false },
    );

    // 2) Cria documento
    const domain = await this.domainModel.create({
      name: externalFqdn,
      type: 'CNAME',
      content: subdomain, // alvo que o cliente vai apontar
      whiteUrl: dto.whiteUrl,
      blackUrl: dto.blackUrl,
      proxied: dnsRes?.proxiable ?? false,
      subdomain,
      userId,
      status: EDomainStatus.PENDING,
      createdAt: new Date(),
    });

    // 3) Custom Hostname (HTTP-DV) -> guarda tokens
    try {
      const ch: CfCustomHostname =
        await this.cloudflare.createCustomHostnameHTTP(externalFqdn, {
          origin: this.EDGE_ORIGIN,
        });

      await this.domainModel.findByIdAndUpdate(domain._id, {
        customHostnameId: ch.id,
        validationRecords: ch.ssl?.validation_records ?? [],
      });
    } catch (err: any) {
      this.logger.error(
        `Falha ao criar Custom Hostname para ${externalFqdn}: ${err?.message || err}`,
      );
    }

    return this.domainModel.findById(domain._id);
  }

  async updateDomain(
    id: string,
    dto: Partial<UpdateDNSRecordDto>,
  ): Promise<DomainDocument> {
    const domain = await this.domainModel.findById(id).exec();
    if (!domain) throw new NotFoundException('Domain not found');
    this.ensureZone();

    // mantém nosso subdomínio; atualiza destino interno se precisar
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
      content: dto.content || this.EDGE_ORIGIN,
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

    // remove Custom Hostname se existir
    if ((domain as any).customHostnameId) {
      try {
        await this.cloudflare.deleteCustomHostnameById(
          (domain as any).customHostnameId,
        );
      } catch (e) {
        this.logger.warn(
          `Falha ao remover Custom Hostname id=${(domain as any).customHostnameId}: ${String(e)}`,
        );
      }
    }

    // remove CNAME interno
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

  // -------- Queries usadas pelos controllers --------

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
    return this.domainModel.findOne({
      $or: [{ subdomain: host }, { name: host }],
    });
  }

  async countActiveByUser(userId: string) {
    return this.domainModel
      .countDocuments({ userId, status: EDomainStatus.ACTIVE })
      .exec();
  }

  // -------- Status/health --------

  private async resolveCNAMEs(host: string): Promise<string[]> {
    const fqdn = this.n(host);
    try {
      const any = await dns.resolveAny(fqdn);
      const cn = any
        .filter((r: any) => r?.type === 'CNAME' && r?.value)
        .map((r: any) => this.n(r.value));
      if (cn.length) return cn;
    } catch (e) {
      console.log(e);
    }
    try {
      const cn2 = await dns.resolveCname(fqdn);
      return (cn2 || []).map((v) => this.n(v));
    } catch (e) {
      console.log(e);
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
      if (res.ok) return { ok: true, status: res.status };

      const controller2 = new AbortController();
      const t2 = setTimeout(() => controller2.abort(), 4000);
      const res2 = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller2.signal,
      });
      clearTimeout(t2);
      return { ok: res2.ok, status: res2.status };
    } catch {
      return { ok: false };
    }
  }

  /** Atualiza status + tokens a partir do CF (útil pós-DV). */
  async refreshCustomHostname(domainId: string) {
    const domain = await this.domainModel.findById(domainId).exec();
    if (!domain) throw new NotFoundException('Domain not found');
    if (!(domain as any).customHostnameId) return { updated: false };

    try {
      const ch = await this.cloudflare.getCustomHostnameById(
        (domain as any).customHostnameId,
      );
      await this.domainModel.findByIdAndUpdate(domainId, {
        validationRecords: ch.ssl?.validation_records ?? [],
      });
      return { updated: true, sslStatus: ch.ssl?.status };
    } catch (e) {
      this.logger.warn(`refreshCustomHostname: ${String(e)}`);
      return { updated: false };
    }
  }

  async checkStatus(domainId: string) {
    const domain = await this.domainModel.findById(domainId).exec();
    if (!domain) throw new NotFoundException('Domain not found');

    const expected = this.n(domain.content); // nosso subdomínio (target esperado)
    const cnames = await this.resolveCNAMEs(domain.name);

    let status = EDomainStatus.PENDING;
    let reason = '';

    if (cnames.length === 0) {
      status = EDomainStatus.PENDING;
      reason = 'CNAME não encontrado para o domínio do cliente.';
    } else if (!cnames.includes(expected)) {
      status = EDomainStatus.ERROR;
      reason = `CNAME aponta para "${cnames[0]}", esperado "${expected}".`;
    } else {
      // CNAME correto -> valida health HTTP (passando pelo EDGE)
      const health = await this.httpHealth(domain.name);
      if (health.ok) status = EDomainStatus.ACTIVE;
      else {
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

  async getAcmeHttpBody(hostname: string): Promise<string | null> {
    const ch = await this.cloudflare.getCustomHostnameByName(hostname);
    const rec = ch?.ssl?.validation_records?.find((r) => r.http_body);
    return rec?.http_body || null;
  }
}
