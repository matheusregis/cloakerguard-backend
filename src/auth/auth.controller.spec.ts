import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { MongooseModule } from '@nestjs/mongoose';
import { createMongoMemoryUri } from '../test-utils/mongo-memory.util';
import { Response } from 'supertest';

interface RegisterResponse {
  email: string;
  password: string;
  _id: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

describe('AuthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mongoUri = await createMongoMemoryUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongoUri), AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/auth/register (POST)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'test@example.com', password: '123456' });

    const body = res.body as RegisterResponse;

    expect(res.status).toBe(201);
    expect(body.email).toBe('test@example.com');
  });

  it('/auth/login (POST)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const res: Response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@example.com', password: '123456' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
  });
});
