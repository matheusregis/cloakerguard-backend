import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUrl,
} from 'class-validator';

export class CreateDNSRecordDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(['A', 'CNAME'])
  @IsOptional()
  type: 'A' | 'CNAME' = 'CNAME';

  @IsString()
  @IsNotEmpty()
  content: string;
  @IsUrl()
  whiteUrl: string;

  @IsUrl()
  blackUrl: string;
}
