// src/logs/schemas/cloaker-log.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class CloakerLog extends Document {
  @Prop() subdomain: string;
  @Prop() ip: string;
  @Prop() userAgent: string;
  @Prop() referer?: string;
  @Prop() isBot: boolean;
  @Prop() redirectedTo: string;
}

export const CloakerLogSchema = SchemaFactory.createForClass(CloakerLog);
