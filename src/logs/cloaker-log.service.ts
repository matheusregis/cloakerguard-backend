import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CloakerLog } from './schemas/cloaker-log.schema';

@Injectable()
export class CloakerLogService {
  constructor(
    @InjectModel(CloakerLog.name) private logModel: Model<CloakerLog>,
  ) {}

  async create(data: Partial<CloakerLog>) {
    await this.logModel.create(data);
  }
}
