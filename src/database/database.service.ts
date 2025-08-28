import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  onModuleInit() {
    this.connection.once('open', () => {
      this.logger.log('✅ Conectado ao MongoDB');
    });

    this.connection.on('error', (err) => {
      this.logger.error('❌ Erro ao conectar ao MongoDB:', err);
    });
  }
}
