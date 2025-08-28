import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DailyStatsDocument = HydratedDocument<DailyStats>;

@Schema({ timestamps: false, _id: true })
export class DailyStats {
  @Prop({ required: true }) userId: string;
  @Prop({ required: true }) domainId: string;
  @Prop({ required: true }) domainName: string;

  @Prop({ required: true }) y: number;
  @Prop({ required: true }) m: number;
  @Prop({ required: true }) d: number;

  @Prop({ required: true, default: 0 }) passed: number;
  @Prop({ required: true, default: 0 }) filtered: number;

  @Prop() lastHitAt?: Date;
}
export const DailyStatsSchema = SchemaFactory.createForClass(DailyStats);
DailyStatsSchema.index({ userId: 1, y: 1, m: 1, d: 1 });
DailyStatsSchema.index({ userId: 1, lastHitAt: -1 });
DailyStatsSchema.index(
  { userId: 1, domainId: 1, y: 1, m: 1, d: 1 },
  { unique: true },
);
