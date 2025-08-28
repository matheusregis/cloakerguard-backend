import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
} from '@nestjs/common';
import { DomainService } from './domain.service';
import { CreateDNSRecordDto } from './dto/create-dns.dto';
import { UpdateDNSRecordDto } from './dto/update-dns.dto';
import { Domain, DomainDocument } from './schemas/domain.schema';

@Controller('domains')
export class DomainController {
  // <<< named export
  constructor(private readonly domainService: DomainService) {}

  @Post(':clientId')
  async createDomain(
    @Param('clientId') clientId: string,
    @Body() body: CreateDNSRecordDto,
  ): Promise<Domain> {
    return this.domainService.createDomain(body, clientId);
  }

  @Get(':clientId')
  async getClientDomains(
    @Param('clientId') clientId: string,
  ): Promise<Domain[]> {
    return this.domainService.findAllByUser(clientId);
  }

  @Get('/subdomain/:subdomain')
  async getBySubdomain(
    @Param('subdomain') subdomain: string,
  ): Promise<Domain | null> {
    return this.domainService.findBySubdomain(subdomain);
  }

  @Put(':domainId')
  updateDomain(
    @Param('domainId') domainId: string,
    @Body() body: UpdateDNSRecordDto,
  ): Promise<DomainDocument> {
    return this.domainService.updateDomain(domainId, body);
  }

  @Delete(':domainId')
  deleteDomain(
    @Param('domainId') domainId: string,
  ): Promise<{ deleted: true }> {
    return this.domainService.deleteDomain(domainId);
  }

  @Get(':domainId/status')
  async getStatus(@Param('domainId') domainId: string) {
    return this.domainService.checkStatus(domainId);
  }
}
