import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Domain, DomainDocument, EDomainStatus } from './schemas/domain.schema';
import { CreateDNSRecordDto } from './dto/create-dns.dto';
import {
  CloudflareService,
  CloudflareDNSResult,
} from './cloudflare/cloudflare.service';
import { UpdateDNSRecordDto } from './dto/update-dns.dto';
import * as dns from 'node:dns/promises';

@Injectable()
export class DomainService {
  private readonly logger = new Logger(DomainService.name);

  private readonly zoneId = process.env.CLOUDFLARE_ZONE_ID!;
  // host/record de origem do seu edge/reverse-proxy por trás da Cloudflare
  private readonly EDGE_ORIGIN =
    process.env.CLOAKER_EDGE_ORIGIN || 'edge.autochecking.com.br';
  private readonly HEALTH_SCHEME = process.env.HEALTHCHECK_SCHEME || 'https';
  private readonly HEALTH_PATH = process.env.HEALTHCHECK_PATH || '/__health';

  constructor(
    @InjectModel(Domain.name)
    private readonly domainModel: Model<DomainDocument>,
    private readonly cloudflareService: CloudflareService,
  ) {}

  private ensureZone() {
    if (!this.zoneId) throw new Error('CLOUDFLARE_ZONE_ID não configurada.');
  }

  // normaliza comparações de FQDN
  private n(v?: string) {
    return (v || '').trim().toLowerCase().replace(/\.$/, '');
  }

  // gera o subdomínio interno: <slug>-<userId>.autochecking.com.br
  private computeSubdomain(externalFqdn: string, userId: string) {
    const host = this.n(externalFqdn)
      .split('.')[0]
      .replace(/[^a-z0-9-]/g, '');
    const label = `${host}-${userId}`.replace(/[^a-z0-9-]/g, '');
    return `${label}.autochecking.com.br`;
  }

  async createDomain(dto: CreateDNSRecordDto, userId: string) {
    this.ensureZone();

    // dto.name vem como FQDN externo (ex: teste.promocao.com.br)
    const externalFqdn = this.n(dto.name);
    const subdomain = this.computeSubdomain(externalFqdn, userId); // nosso alvo
    const subLabel = subdomain.replace('.autochecking.com.br', ''); // label dentro da zona

    // Criamos na nossa zona um CNAME <subLabel> -> EDGE_ORIGIN
    const response: CloudflareDNSResult =
      await this.cloudflareService.createDNSRecord(
        subLabel, // name dentro da zona
        'CNAME',
        this.EDGE_ORIGIN,
        { zoneId: this.zoneId, proxied: false },
      );

    const domain = await this.domainModel.create({
      name: externalFqdn, // domínio do cliente
      type: 'CNAME',
      content: subdomain, // alvo esperado p/ CNAME do cliente
      whiteUrl: dto.whiteUrl,
      blackUrl: dto.blackUrl,
      proxied: response?.result?.proxied ?? false,
      subdomain, // nosso subdomínio na Cloudflare
      userId,
      status: EDomainStatus.PENDING,
      createdAt: new Date(),
    });

    return domain;
  }

  async updateDomain(
    id: string,
    dto: Partial<UpdateDNSRecordDto>,
  ): Promise<DomainDocument> {
    const domain = await this.domainModel.findById(id).exec();
    if (!domain) throw new NotFoundException('Domain not found');

    this.ensureZone();

    // IMPORTANTE:
    // Não alteramos o "name" do registro da Cloudflare para o FQDN externo do cliente.
    // Nosso registro na zona é o "subdomain" (ex: teste-uid.autochecking.com.br).
    const dnsRecord = await this.cloudflareService.getDNSRecordId(
      domain.subdomain,
      {
        zoneId: this.zoneId,
        type: 'CNAME',
      },
    );
    if (!dnsRecord)
      throw new NotFoundException('Registro DNS não encontrado no Cloudflare.');

    // Só atualize "content" se quiser apontar para outra origem interna (EDGE_ORIGIN).
    await this.cloudflareService.updateDNSRecordById(
      this.zoneId,
      dnsRecord.id,
      {
        type: 'CNAME',
        content: dto.content || this.EDGE_ORIGIN,
        name: domain.subdomain, // garante que permanece o nosso subdomínio
        proxied: false,
      },
    );

    // Atualiza dados de exibição/negócio do domínio do cliente
    const updated = await this.domainModel
      .findByIdAndUpdate(
        id,
        {
          name: dto.name ?? domain.name, // FQDN externo pode mudar
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

    const dnsRecord = await this.cloudflareService.getDNSRecordId(
      domain.subdomain,
      {
        zoneId: this.zoneId,
        type: 'CNAME',
      },
    );
    if (!dnsRecord)
      throw new NotFoundException('Registro DNS não encontrado no Cloudflare.');

    await this.cloudflareService.deleteDNSRecordById(this.zoneId, dnsRecord.id);
    await this.domainModel.findByIdAndDelete(id).exec();

    return { deleted: true };
  }

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
    return this.domainModel.findOne({ subdomain: subdomain });
  }

  // ===== STATUS =====

  private async resolveCNAMEs(host: string): Promise<string[]> {
    const fqdn = this.n(host);
    try {
      const any = await dns.resolveAny(fqdn);
      const cnames = any
        .filter((r: any) => r?.type === 'CNAME' && r?.value)
        .map((r: any) => this.n(r.value));
      if (cnames.length) return cnames;
    } catch {}
    try {
      const cn = await dns.resolveCname(fqdn);
      return (cn || []).map((v) => this.n(v));
    } catch {}
    return [];
  }

  private async httpHealth(
    fqdn: string,
  ): Promise<{ ok: boolean; status?: number }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const url = `${this.HEALTH_SCHEME}://${fqdn}${this.HEALTH_PATH}`;
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return { ok: true, status: res.status };
      // fallback GET (alguns provedores bloqueiam HEAD)
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 4000);
      const res2 = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller2.signal,
      });
      clearTimeout(timer2);
      return { ok: res2.ok, status: res2.status };
    } catch {
      return { ok: false };
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
      // CNAME correto -> valida health HTTP
      const health = await this.httpHealth(domain.name);
      if (health.ok) {
        status = EDomainStatus.ACTIVE;
      } else {
        status = EDomainStatus.PROPAGATING;
        reason = 'CNAME correto, aguardando propagação/HTTP.';
      }
    }

    domain.status = status;
    domain.lastReason = reason || undefined;
    domain.lastCheckedAt = new Date();
    await domain.save();

    return {
      status,
      reason: domain.lastReason,
      checkedAt: domain.lastCheckedAt,
    };
  }
  async findByHost(host: string) {
    return this.domainModel.findOne({
      $or: [{ subdomain: host }, { name: host }],
    });
  }

  async countActiveByUser(userId: string) {
    return await this.domainModel
      .countDocuments({ userId, status: EDomainStatus.ACTIVE })
      .exec();
  }
}
