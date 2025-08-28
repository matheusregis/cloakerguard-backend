import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';

type AddressLinePayload = {
  line_1: string;
  line_2?: string;
  neighborhood?: string; // usado apenas em payments.billing.address
  zip_code: string; // só dígitos
  city: string;
  state: string; // 2 letras
  country: string; // 2 letras (ex: BR)
};

type CustomerPayload = {
  name: string;
  email: string;
  type: 'individual' | 'company';
  document: string; // só dígitos
  phones?: {
    mobile_phone: {
      country_code: string;
      area_code: string;
      number: string;
    };
  };
  address?: AddressLinePayload;
};

type CardData =
  | {
      number: string;
      holder_name: string;
      exp_month: string;
      exp_year: string;
      cvv: string;
      billing_address: Omit<AddressLinePayload, 'neighborhood'>;
    }
  | {
      token: string;
      billing_address: Omit<AddressLinePayload, 'neighborhood'>;
    };

@Injectable()
export class PagarmeService {
  private readonly api: AxiosInstance;
  private readonly accountId: string;

  constructor() {
    const baseURL =
      process.env.PAGARME_API_BASE || 'https://api.pagar.me/core/v5';
    const sk = process.env.PAGARME_API_KEY; // sk_test_... / sk_live_...
    this.accountId = process.env.PAGARME_ACCOUNT_ID || '';
    if (!sk) throw new Error('PAGARME_API_KEY não configurada');

    // Core v5 -> Basic base64("sk_xxx:")
    const basic = Buffer.from(`${sk}:`).toString('base64');

    this.api = axios.create({
      baseURL,
      timeout: 20000,
      headers: {
        Authorization: `Basic ${basic}`,
        ...(this.accountId ? { 'x-account-id': this.accountId } : {}),
        'Content-Type': 'application/json',
      },
    });
  }

  private onlyDigits(v?: string) {
    return (v || '').replace(/\D+/g, '');
  }
  private up2(v?: string) {
    return (v || '').toUpperCase().slice(0, 2);
  }

  async createCardOrderExact(input: {
    amount: number;
    description: string;
    code: string;
    customer: {
      name: string;
      email: string;
      type: 'individual' | 'company';
      document: string;
      phones?: { country_code: string; area_code: string; number: string };
      address?: {
        line_1: string;
        line_2?: string;
        zip_code: string;
        city: string;
        state: string;
        country: string;
      };
    };
    billingAddress: {
      line_1: string;
      line_2?: string;
      neighborhood?: string;
      zip_code: string;
      city: string;
      state: string;
      country: string;
    };
    installments: number;
    capture?: boolean;
    card:
      | {
          number: string;
          holder_name: string;
          exp_month: string;
          exp_year: string;
          cvv: string;
        }
      | { token: string };
    cardBillingAddress: {
      line_1: string;
      line_2?: string;
      zip_code: string;
      city: string;
      state: string;
      country: string;
    };
    metadata?: Record<string, any>;
  }) {
    // --- customer ---
    const cust: CustomerPayload = {
      name: input.customer.name,
      email: input.customer.email,
      type: input.customer.type,
      document: this.onlyDigits(input.customer.document),
    };

    if (input.customer.phones) {
      cust.phones = {
        mobile_phone: {
          country_code:
            this.onlyDigits(input.customer.phones.country_code) || '55',
          area_code: this.onlyDigits(input.customer.phones.area_code),
          number: this.onlyDigits(input.customer.phones.number),
        },
      };
    }

    if (input.customer.address) {
      cust.address = {
        line_1: input.customer.address.line_1,
        line_2: input.customer.address.line_2,
        zip_code: this.onlyDigits(input.customer.address.zip_code),
        city: input.customer.address.city,
        state: this.up2(input.customer.address.state),
        country: this.up2(input.customer.address.country),
      };
    }

    // payments[0].billing.address
    const billingAddress: AddressLinePayload = {
      line_1: input.billingAddress.line_1,
      line_2: input.billingAddress.line_2,
      neighborhood: input.billingAddress.neighborhood,
      zip_code: this.onlyDigits(input.billingAddress.zip_code),
      city: input.billingAddress.city,
      state: this.up2(input.billingAddress.state),
      country: this.up2(input.billingAddress.country),
    };

    // credit_card.card.billing_address (sem neighborhood)
    const cardBillingAddress = {
      line_1: input.cardBillingAddress.line_1,
      line_2: input.cardBillingAddress.line_2,
      zip_code: this.onlyDigits(input.cardBillingAddress.zip_code),
      city: input.cardBillingAddress.city,
      state: this.up2(input.cardBillingAddress.state),
      country: this.up2(input.cardBillingAddress.country),
    };

    const card: CardData =
      'token' in input.card
        ? { token: input.card.token, billing_address: cardBillingAddress }
        : {
            number: this.onlyDigits(input.card.number),
            holder_name: input.card.holder_name,
            exp_month: input.card.exp_month,
            exp_year: input.card.exp_year,
            cvv: this.onlyDigits(input.card.cvv),
            billing_address: cardBillingAddress,
          };

    // ==== payload final ====
    const orderPayload = {
      items: [
        {
          amount: input.amount,
          description: input.description,
          quantity: 1,
          code: input.code,
        },
      ],
      customer: cust,
      payments: [
        {
          payment_method: 'credit_card',
          billing: { address: billingAddress },
          credit_card: {
            installments: input.installments,
            capture: input.capture ?? true,
            card,
          },
        },
      ],
      metadata: input.metadata || {},
    };

    const { data } = await this.api.post('/orders', orderPayload, {
      headers: { 'Idempotency-Key': randomUUID() },
    });
    return data; // mantém retorno aqui (controller decide o que expor)
  }

  async createPixOrder(input: {
    amount: number;
    description: string;
    code: string;
    customer: {
      name: string;
      document: string;
      phone?: string; // <- novo
      email?: string; // <- opcional
    };
    expires_in?: number;
    metadata?: Record<string, any>;
  }) {
    const onlyDigits = (v?: string) => (v || '').replace(/\D+/g, '');
    const splitPhone = (raw?: string) => {
      const d = onlyDigits(raw);
      return {
        country_code: d.slice(0, 2) || '55',
        area_code: d.slice(2, 4) || '11',
        number: d.slice(4) || '999999999',
      };
    };

    const payload = {
      items: [
        {
          amount: input.amount,
          description: input.description,
          quantity: 1,
          code: input.code,
        },
      ],
      customer: {
        name: input.customer.name,
        document: onlyDigits(input.customer.document),
        type: 'individual',
        ...(input.customer.email
          ? { email: input.customer.email }
          : { email: 'teste@teste.com' }),
        phones: { mobile_phone: splitPhone(input.customer.phone) }, // <- sempre envia
      },
      payments: [
        {
          payment_method: 'pix',
          pix: { expires_in: input.expires_in ?? 600 },
        },
      ],
      metadata: input.metadata || {},
    };

    const { data } = await this.api.post('/orders', payload, {
      headers: { 'Idempotency-Key': randomUUID() },
    });

    // Se o Pagar.me já retornar erro/failed, propague mensagem legível
    const ch = data?.charges?.[0];
    const tx = ch?.last_transaction || {};
    const pix = tx?.pix || tx || {};
    const failed =
      data?.status === 'failed' ||
      ch?.status === 'failed' ||
      tx?.status === 'failed';
    const msg = tx?.gateway_response?.errors?.[0]?.message;

    if (failed) {
      throw new Error(msg || 'Falha ao criar cobrança Pix');
    }

    return {
      order: data,
      normalized: {
        order_id: data?.id,
        status: data?.status,
        copia_cola:
          pix.qr_code || pix.qr_code_text || pix.qrcode || pix.emvqrcps || null,
        qr_code_base64:
          pix.qr_code_base64 || pix.qrcode_base64 || pix.qr_code_image || null,
        expires_at: pix.expires_at || null,
      },
    };
  }

  async getOrder(orderId: string) {
    const { data } = await this.api.get(`/orders/${orderId}`);
    return data;
  }

  // Validação opcional de assinatura do webhook
  verifyWebhookSignature(rawBody: Buffer, header?: string): boolean {
    const secret = process.env.PAGARME_WEBHOOK_SECRET;
    if (!secret) return true;
    if (!header) return false;

    // header no formato "sha256=abcdef..."
    const [algo, sig] = header.split('=');
    const hmac = crypto.createHmac(
      (algo as crypto.BinaryToTextEncoding) || 'sha256',
      secret,
    );
    hmac.update(rawBody);
    const digest = hmac.digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));
    } catch {
      return false;
    }
  }
}
