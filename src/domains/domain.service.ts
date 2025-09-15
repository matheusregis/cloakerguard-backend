// src/domains/domain.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Domain,
  DomainDocument,
  ECertStatus,
  EDomainStatus,
} from './schemas/domain.schema';
import { CreateDNSRecordDto } from './dto/create-dns.dto';
import { UpdateDNSRecordDto } from './dto/update-dns.dto';
import * as dns from 'node:dns/promises';
import { FlyCertificatesService } from './fly/fly.service';
import { AnalyticsService } from '../modules/analytics/analytics.service'; // 🔑 usado p/ limites

@Injectable()
export class DomainService {
  private readonly logger = new Logger(DomainService.name);

  private readonly EDGE_ORIGIN =
    process.env.CLOAKER_EDGE_ORIGIN || 'edge.cloakerguard.com.br';
  private readonly HEALTH_SCHEME = process.env.HEALTHCHECK_SCHEME || 'https';
  private readonly HEALTH_PATH =
    process.env.HEALTHCHECK_PATH || '/__edge-check';
  private readonly FLY_APP =
    process.env.FLY_APP_FOR_CERTS || 'proxy-cloakerguard';

  constructor(
    @InjectModel(Domain.name)
    private readonly domainModel: Model<DomainDocument>,
    private readonly fly: FlyCertificatesService,
    private readonly analytics: AnalyticsService, // injeta service de analytics
  ) {}

  private n(v?: string) {
    return (v || '').trim().toLowerCase().replace(/\.$/, '');
  }

  // -------- CRUD --------

  async createDomain(dto: CreateDNSRecordDto, userId: string) {
    const externalFqdn = this.n(dto.name);

    let domain = (await this.domainModel.create({
      name: externalFqdn,
      type: 'CNAME',
      content: this.EDGE_ORIGIN, // todos apontam para o edge
      whiteUrl: dto.whiteUrl,
      blackUrl: dto.blackUrl,
      subdomain: externalFqdn,
      userId,
      status: EDomainStatus.PENDING,
      certStatus: ECertStatus.PENDING,
      createdAt: new Date(),
    })) as DomainDocument;

    domain = await this.ensureFlyCertificate(domain);

    return this.domainModel.findById(domain._id);
  }

  async updateDomain(
    id: string,
    dto: Partial<UpdateDNSRecordDto>,
  ): Promise<DomainDocument> {
    const updated = await this.domainModel
      .findByIdAndUpdate(
        id,
        {
          name: dto.name,
          whiteUrl: dto.whiteUrl,
          blackUrl: dto.blackUrl,
        },
        { new: true },
      )
      .exec();

    if (!updated) throw new NotFoundException('Domain not found after update');

    if (dto.name && this.n(dto.name) !== this.n(updated.name)) {
      updated.name = this.n(dto.name);
      updated.certStatus = ECertStatus.PENDING;
      await updated.save();
      await this.ensureFlyCertificate(updated);
    }

    return updated;
  }

  async deleteDomain(id: string): Promise<{ deleted: true }> {
    const domain = await this.domainModel.findById(id).exec();
    if (!domain) throw new NotFoundException('Domain not found');

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
    return this.domainModel.findOne({
      $or: [{ subdomain: host }, { name: host }],
    });
  }

  async countActiveByUser(userId: string) {
    return this.domainModel
      .countDocuments({ userId, status: EDomainStatus.ACTIVE })
      .exec();
  }

  // -------- Novo método usado pelo Edge --------

  async resolveDomain(host: string) {
    const domain = await this.findByHost(host);
    if (!domain) throw new NotFoundException('Domain not found');

    const userId = domain.userId;

    // domínios ativos
    const activeDomainsUsed = await this.countActiveByUser(userId);

    // uso de cliques (service de analytics retorna { used, limit, domainsLimit })
    const clicks = await this.analytics.getMonthlyUsage(userId);

    const planUsage = {
      monthlyClicksUsed: clicks.used,
      monthlyClicksLimit: clicks.limit,
      activeDomainsUsed,
      activeDomainsLimit: clicks.domainsLimit,
    };

    return {
      id: String(domain._id),
      userId,
      host: domain.name,
      whiteOrigin: domain.whiteUrl,
      blackOrigin: domain.blackUrl,
      rules: (domain as any).rules || {},
      planUsage,
    };
  }

  // -------- Certificados (Fly) --------

  private async ensureFlyCertificate(domain: DomainDocument) {
    try {
      const hostname = this.n(domain.name);

      const add = await this.fly.addCertificate(this.FLY_APP, hostname);

      const httpOK = !!add.isAcmeHttpConfigured || !!add.acmeAlpnConfigured;
      const dnsConfigured = !!add.acmeDnsConfigured;

      if (!httpOK && !dnsConfigured) {
        domain.certStatus = ECertStatus.DNS01_NEEDED;
        domain.acmeMethod = 'DNS01';
        domain.acmeDnsCnameName = add.dnsValidationHostname || undefined;
        domain.acmeDnsCnameTarget = add.dnsValidationTarget || undefined;

        const recs = domain.validationRecords || [];
        if (add.dnsValidationHostname && add.dnsValidationTarget) {
          recs.push({
            txt_name: add.dnsValidationHostname,
            txt_value: add.dnsValidationTarget,
          });
        }
        domain.validationRecords = recs;
        await domain.save();
        return domain;
      }

      const chk = await this.fly.checkCertificate(this.FLY_APP, hostname);

      domain.flyCertClientStatus = chk.clientStatus || undefined;
      domain.flyCertConfigured = !!chk.configured;

      if (chk.clientStatus === 'Ready' && chk.configured) {
        domain.certStatus = ECertStatus.READY;
      } else {
        domain.certStatus = ECertStatus.PENDING;
      }

      await domain.save();
      return domain;
    } catch (e: any) {
      this.logger.error(`ensureFlyCertificate error: ${e?.message || e}`);
      domain.certStatus = ECertStatus.FAILED;
      domain.lastReason = `Fly cert error: ${e?.message || 'unknown'}`;
      await domain.save();
      return domain;
    }
  }

  // -------- Status/health --------

  private async resolveCNAMEs(host: string): Promise<string[]> {
    const fqdn = this.n(host);
    try {
      const cn2 = await dns.resolveCname(fqdn);
      return (cn2 || []).map((v) => this.n(v));
    } catch {
      return [];
    }
  }

  private async httpHealth(
    fqdn: string,
  ): Promise<{ ok: boolean; status?: number }> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      const url = `${this.HEALTH_SCHEME}://${fqdn}${this.HEALTH_PATH}`;
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(t);
      return { ok: res.ok, status: res.status };
    } catch {
      return { ok: false };
    }
  }

  async checkStatus(domainId: string) {
    const domain = await this.domainModel.findById(domainId).exec();
    if (!domain) throw new NotFoundException('Domain not found');

    const expected = this.n(this.EDGE_ORIGIN);
    const cnames = await this.resolveCNAMEs(domain.name);

    let status = EDomainStatus.PENDING;
    let reason = '';

    if (cnames.length === 0) {
      status = EDomainStatus.PENDING;
      reason = 'CNAME não encontrado.';
    } else if (!cnames.includes(expected)) {
      status = EDomainStatus.ERROR;
      reason = `CNAME aponta para "${cnames[0]}", esperado "${expected}".`;
    } else {
      try {
        const chk = await this.fly.checkCertificate(
          this.FLY_APP,
          this.n(domain.name),
        );
        domain.flyCertClientStatus = chk.clientStatus || undefined;
        domain.flyCertConfigured = !!chk.configured;

        if (chk.clientStatus === 'Ready' && chk.configured) {
          domain.certStatus = ECertStatus.READY;
        } else if (
          chk.dnsValidationHostname &&
          chk.dnsValidationTarget &&
          !chk.isAcmeHttpConfigured &&
          !chk.acmeAlpnConfigured
        ) {
          domain.certStatus = ECertStatus.DNS01_NEEDED;
          domain.acmeMethod = 'DNS01';
          domain.acmeDnsCnameName = chk.dnsValidationHostname;
          domain.acmeDnsCnameTarget = chk.dnsValidationTarget;
        } else {
          domain.certStatus = ECertStatus.PENDING;
        }
      } catch (e: any) {
        this.logger.warn(`checkStatus: fly check failed: ${e?.message || e}`);
      }

      if (domain.certStatus === ECertStatus.READY) {
        const health = await this.httpHealth(domain.name);
        if (health.ok) {
          status = EDomainStatus.ACTIVE;
          reason = 'Domínio ativo e saudável.';
        } else {
          status = EDomainStatus.PROPAGATING;
          reason = 'CNAME correto e cert pronto, aguardando saúde HTTP.';
        }
      } else if (domain.certStatus === ECertStatus.DNS01_NEEDED) {
        status = EDomainStatus.PENDING;
        reason =
          'CNAME correto. Necessário criar CNAME do _acme-challenge (DNS-01).';
      } else {
        status = EDomainStatus.PROPAGATING;
        reason =
          'CNAME correto. Certificado em emissão (HTTP/ALPN) no Fly (aguarde).';
      }
    }

    domain.status = status;
    (domain as any).lastReason = reason || undefined;
    (domain as any).lastCheckedAt = new Date();
    await domain.save();

    return {
      status,
      certStatus: domain.certStatus,
      reason: (domain as any).lastReason,
      checkedAt: (domain as any).lastCheckedAt,
      dns01:
        domain.certStatus === ECertStatus.DNS01_NEEDED
          ? {
              cnameName: domain.acmeDnsCnameName,
              cnameTarget: domain.acmeDnsCnameTarget,
            }
          : undefined,
      fly: {
        clientStatus: domain.flyCertClientStatus,
        configured: domain.flyCertConfigured,
      },
    };
  }
}
