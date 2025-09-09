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
      content: 'edge.cloakerguard.com.br',
      whiteUrl: dto.whiteUrl,
      blackUrl: dto.blackUrl,
      subdomain: `${externalFqdn.split('.')[0]}-${userId}.cloakerguard.com.br`,
      userId,
      status: EDomainStatus.PENDING,
      createdAt: new Date(),
    });

    this.logger.log(
      `[createDomain] Criado domínio: ${domain.name} → ${domain.subdomain}`,
    );
    return domain;
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

    if (!updated) throw new NotFoundException('Domain not found');
    this.logger.log(`[updateDomain] Atualizado: ${updated.name}`);
    return updated;
  }

  async deleteDomain(id: string): Promise<{ deleted: true }> {
    const domain = await this.domainModel.findById(id).exec();
    if (!domain) throw new NotFoundException('Domain not found');

    await this.domainModel.findByIdAndDelete(id).exec();
    this.logger.warn(`[deleteDomain] Removido: ${domain.name}`);
    return { deleted: true };
  }

  async findAllByUser(userId: string) {
    return this.domainModel.find({ userId });
  }

  async findOne(id: string) {
    return this.domainModel.findById(id);
  }

  async findBySubdomain(subdomain: string) {
    const s = this.n(subdomain);
    this.logger.debug(`[findBySubdomain] procurando por ${s}`);
    return this.domainModel.findOne({ subdomain: s });
  }

  async findByHost(host: string) {
    const h = this.n(host);
    this.logger.debug(`[findByHost] procurando por ${h}`);
    const found = await this.domainModel.findOne({
      $or: [{ name: h }, { subdomain: h }],
    });
    this.logger.debug(
      `[findByHost] resultado para ${h}: ${found ? found.name : 'NOT FOUND'}`,
    );
    return found;
  }

  async countActiveByUser(userId: string) {
    return this.domainModel
      .countDocuments({ userId, status: EDomainStatus.ACTIVE })
      .exec();
  }

  // -------- Status (simplificado) --------

  private async resolveCNAMEs(host: string): Promise<string[]> {
    const fqdn = this.n(host);
    try {
      const cn = await dns.resolveCname(fqdn);
      if (cn.length) return cn.map((v) => this.n(v));
    } catch (e: any) {
      this.logger.warn(`[resolveCNAMEs] resolveCname falhou: ${e.code}`);
    }
    return [];
  }

  async checkStatus(domainId: string) {
    const domain = await this.domainModel.findById(domainId).exec();
    if (!domain) throw new NotFoundException('Domain not found');

    const cnames = await this.resolveCNAMEs(domain.name);
    let status = EDomainStatus.PENDING;
    let reason = '';

    if (cnames.length === 0) {
      status = EDomainStatus.PENDING;
      reason = 'CNAME não encontrado.';
    } else if (!cnames.includes(this.n(domain.content))) {
      status = EDomainStatus.ERROR;
      reason = `Aponta para ${cnames[0]}, esperado ${domain.content}`;
    } else {
      status = EDomainStatus.ACTIVE;
    }

    domain.status = status;
    (domain as any).lastReason = reason || undefined;
    (domain as any).lastCheckedAt = new Date();
    await domain.save();

    this.logger.log(
      `[checkStatus] ${domain.name} → ${status} (${reason || 'ok'})`,
    );

    return {
      status,
      reason: (domain as any).lastReason,
      checkedAt: (domain as any).lastCheckedAt,
    };
  }
}
