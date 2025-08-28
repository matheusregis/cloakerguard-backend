import { IsIn } from 'class-validator';

export class CreateDNSRecordDto {
  name: string;

  @IsIn(['A', 'CNAME'])
  type: 'A' | 'CNAME';

  content: string;
}
