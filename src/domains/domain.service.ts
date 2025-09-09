import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Domain, DomainDocument, EDomainStatus } from './schemas/domain.schema';
import { CreateDNSRecordDto } from './dto/create-dns.dto';
import { UpdateDNSRecordDto } from './dto/update-dns.dto';
import * as dns from 'node:dns/promises';

@Injectable()
export class DomainService {
  private readonly logger = new Logger(DomainService.name);

  private readonly EDGE_ORIGIN =
    process.env.CLOAKER_EDGE_ORIGIN || 'edge.cloakerguard.com.br';
  private readonly HEALTH_SCHEME = process.env.HEALTHCHECK_SCHEME || 'https';
  private readonly HEALTH_PATH =
    process.env.HEALTHCHECK_PATH || '/__edge-check';

  constructor(
    @InjectModel(Domain.name)
    private readonly domainModel: Model<DomainDocument>,
  ) {}

  private n(v?: string) {
    return (v || '').trim().toLowerCase().replace(/\.$/, '');
  }

  // -------- CRUD --------

  async createDomain(dto: CreateDNSRecordDto, userId: string) {
    const externalFqdn = this.n(dto.name);

    const domain = await this.domainModel.create({
      name: externalFqdn,
      type: 'CNAME',
      content: this.EDGE_ORIGIN, // todos apontam para o edge
      whiteUrl: dto.whiteUrl,
      blackUrl: dto.blackUrl,
      subdomain: externalFqdn,
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
    return updated;
  }

  async deleteDomain(id: string): Promise<{ deleted: true }> {
    const domain = await this.domainModel.findById(id).exec();
    if (!domain) throw new NotFoundException('Domain not found');

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
        method: 'HEAD',
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
}
