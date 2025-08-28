import { Body, Controller, Post } from '@nestjs/common';
import { CloudflareService, CloudflareDNSResult } from './cloudflare.service';
import { CreateDNSRecordDto } from './dto/create-dns-record.dto';

@Controller('cloudflare')
export class CloudflareController {
  constructor(private readonly cloudflareService: CloudflareService) {}

  @Post('dns')
  async createRecord(
    @Body() body: CreateDNSRecordDto,
  ): Promise<CloudflareDNSResult> {
    const { name, type, content } = body;
    return this.cloudflareService.createDNSRecord(name, type, content);
  }
}
