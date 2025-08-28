export interface DomainConfig {
  _id?: string;
  clientId: string;
  hostname: string; // ex: teste.autochecking.com.br
  whiteLabelUrl: string;
  blackLabelUrl: string;
  createdAt?: Date;
}
