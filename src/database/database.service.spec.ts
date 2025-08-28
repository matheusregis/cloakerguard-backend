import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseService } from './database.service';
import { createMongoMemoryUri } from '../test-utils/mongo-memory.util';

describe('DatabaseService', () => {
  let service: DatabaseService;

  beforeAll(async () => {
    const uri = await createMongoMemoryUri();

    const module: TestingModule = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(uri)],
      providers: [DatabaseService],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
