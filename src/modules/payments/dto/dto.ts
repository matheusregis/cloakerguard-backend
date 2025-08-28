// src/payments/payments.dto.ts
import {
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsEmail,
  IsNumber,
  IsPositive,
} from 'class-validator';

export class CustomerDto {
  @IsString() name!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsString() phone?: string;
}

export class ChargeCardDto {
  @IsInt() @Min(1) amount!: number; // em centavos
  @IsString() card_token!: string;
  @IsOptional() @IsInt() @Min(1) installments?: number;

  customer!: CustomerDto;

  @IsOptional() metadata?: Record<string, any>;
  @IsOptional() @IsString() description?: string;
}

export class CreatePixDto {
  @IsInt() @Min(1) amount!: number;

  customer!: CustomerDto;

  @IsOptional() metadata?: Record<string, any>;
  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsInt() @Min(60) expires_in?: number; // seg (min 60 recomendado)
}
