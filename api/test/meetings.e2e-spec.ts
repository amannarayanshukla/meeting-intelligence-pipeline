import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MEETINGS_QUEUE } from '../src/meetings/meeting.entity.js';
import { MeetingsController } from '../src/meetings/meetings.controller.js';
import { MeetingsService } from '../src/meetings/meetings.service.js';
import { InMemoryMeetingRepository } from '../src/meetings/repository/in-memory-meeting.repository.js';
import { MeetingRepository } from '../src/meetings/repository/meeting.repository.js';
import { FakeQueue } from '../src/testing/fake-queue.js';

describe('Meetings API', () => {
  let app: INestApplication;
  let repo: InMemoryMeetingRepository;
  let queue: FakeQueue;

  beforeAll(async () => {
    repo = new InMemoryMeetingRepository();
    queue = new FakeQueue();
    const moduleRef = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        MeetingsService,
        { provide: MeetingRepository, useValue: repo },
        { provide: getQueueToken(MEETINGS_QUEUE), useValue: queue },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(() => app.close());

  it('POST /api/meetings → 202 { id } and enqueues three jobs', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/meetings')
      .send({ transcript: 'hello' })
      .expect(202);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      queue.calls.filter(
        (c) => (c.data as { meetingId: string }).meetingId === res.body.id,
      ),
    ).toHaveLength(3);
  });

  it('POST with empty transcript → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/meetings')
      .send({ transcript: '' })
      .expect(400);
  });

  it('POST with missing transcript → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/meetings')
      .send({})
      .expect(400);
  });

  it('GET unknown id → 404', async () => {
    await request(app.getHttpServer()).get('/api/meetings/ghost').expect(404);
  });

  it('GET reflects repository patches and derived status', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/meetings')
      .send({ transcript: 'hello' });
    const id: string = body.id;

    let res = await request(app.getHttpServer())
      .get(`/api/meetings/${id}`)
      .expect(200);
    expect(res.body).toMatchObject({
      id,
      status: 'processing',
      summary: null,
      actions: null,
      vector: null,
    });

    await repo.patch(id, { summary: ['a'] });
    res = await request(app.getHttpServer())
      .get(`/api/meetings/${id}`)
      .expect(200);
    expect(res.body).toMatchObject({ status: 'processing', summary: ['a'] });

    await repo.patch(id, {
      actions: [{ task: 't', assignee: 'a' }],
      vector: Array(768).fill(0.5),
    });
    res = await request(app.getHttpServer())
      .get(`/api/meetings/${id}`)
      .expect(200);
    expect(res.body).toMatchObject({ status: 'done', vector: { dims: 768 } });
    expect(res.body.vector.preview).toHaveLength(8);
  });
});
