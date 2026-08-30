import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LlmModule } from '../llm/llm.module.js';
import { MEETINGS_QUEUE } from './meeting.entity.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';
import { ActionExtractorProcessor } from './processors/action-extractor.processor.js';
import { SummarizeProcessor } from './processors/summarize.processor.js';
import {
  PROCESSORS,
  TranscriptProcessor,
} from './processors/transcript.processor.js';
import { VectorizeProcessor } from './processors/vectorize.processor.js';
import { MeetingWorker } from './queue/meeting.worker.js';
import { MeetingRepository } from './repository/meeting.repository.js';
import {
  MeetingDoc,
  MeetingSchema,
  MongoMeetingRepository,
} from './repository/mongo-meeting.repository.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: MEETINGS_QUEUE }),
    MongooseModule.forFeature([
      { name: MeetingDoc.name, schema: MeetingSchema },
    ]),
    LlmModule,
  ],
  controllers: [MeetingsController],
  providers: [
    MeetingsService,
    MeetingWorker, // ponytail: worker lives in the API process. Move to its own entrypoint to scale independently.
    SummarizeProcessor,
    ActionExtractorProcessor,
    VectorizeProcessor,
    {
      provide: PROCESSORS,
      useFactory: (...processors: TranscriptProcessor[]) => processors,
      inject: [
        SummarizeProcessor,
        ActionExtractorProcessor,
        VectorizeProcessor,
      ],
    },
    { provide: MeetingRepository, useClass: MongoMeetingRepository },
  ],
})
export class MeetingsModule {}
