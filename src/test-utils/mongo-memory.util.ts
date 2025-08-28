import { MongoMemoryServer } from 'mongodb-memory-server';

export const createMongoMemoryUri = async (): Promise<string> => {
  const mongoServer = await MongoMemoryServer.create();
  return mongoServer.getUri();
};
