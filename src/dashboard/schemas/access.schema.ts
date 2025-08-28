import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Access extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  domain: string;

  @Prop({ required: true })
  passed: number;

  @Prop({ required: true })
  filtered: number;

  @Prop({ required: true })
  status: 'active' | 'paused';
}

export const AccessSchema = SchemaFactory.createForClass(Access);
