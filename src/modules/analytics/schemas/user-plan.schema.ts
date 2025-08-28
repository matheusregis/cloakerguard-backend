import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserPlanDocument = HydratedDocument<UserPlan>;

@Schema({ timestamps: false })
export class UserPlan {
  @Prop({ required: true, unique: true }) userId: string;
  @Prop({ required: true }) planId: 'free' | 'pro' | 'enterprise';
  @Prop({ required: true }) monthlyClicks: number; // limite
  @Prop({ required: true }) maxDomains: number; // limite
  @Prop({ required: true }) cycleStart: Date;
  @Prop({ required: true }) cycleEnd: Date;
}
export const UserPlanSchema = SchemaFactory.createForClass(UserPlan);
