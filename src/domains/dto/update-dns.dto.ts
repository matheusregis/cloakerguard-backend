// src/domains/dto/update-dns.dto.ts

import { IsString, IsOptional } from 'class-validator';

export class UpdateDNSRecordDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  whiteUrl?: string;

  @IsOptional()
  @IsString()
  blackUrl?: string;
}
