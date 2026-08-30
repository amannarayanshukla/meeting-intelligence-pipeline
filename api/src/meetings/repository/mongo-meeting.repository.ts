import { Injectable } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, SchemaTypes } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  ActionItem,
  JobKind,
  Meeting,
  MeetingUpdate,
} from '../meeting.entity.js';
import { MeetingRepository } from './meeting.repository.js';

@Schema({ collection: 'meetings', versionKey: false, minimize: false })
export class MeetingDoc {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true }) transcript!: string;
  @Prop({ type: SchemaTypes.Mixed, default: null }) summary!: string[] | null;
  @Prop({ type: SchemaTypes.Mixed, default: null }) actions!:
    ActionItem[] | null;
  @Prop({ type: SchemaTypes.Mixed, default: null }) vector!: number[] | null;
  @Prop({ type: SchemaTypes.Mixed, default: {} }) errors!: Partial<
    Record<JobKind, string>
  >;
  @Prop({ type: Date, required: true }) createdAt!: Date;
}
export const MeetingSchema = SchemaFactory.createForClass(MeetingDoc);

function toMeeting(d: MeetingDoc): Meeting {
  return {
    id: d._id,
    transcript: d.transcript,
    summary: d.summary ?? null,
    actions: d.actions ?? null,
    vector: d.vector ?? null,
    errors: d.errors ?? {},
    createdAt: d.createdAt,
  };
}

// ponytail: untested by CI (would need mongodb-memory-server); the InMemory impl pins the contract, this one is smoke-tested in Task 8 step 6.
@Injectable()
export class MongoMeetingRepository extends MeetingRepository {
  constructor(
    @InjectModel(MeetingDoc.name) private readonly model: Model<MeetingDoc>,
  ) {
    super();
  }

  async create({ transcript }: { transcript: string }): Promise<Meeting> {
    const doc = await this.model.create({
      _id: randomUUID(),
      transcript,
      summary: null,
      actions: null,
      vector: null,
      errors: {},
      createdAt: new Date(),
    });
    return toMeeting(doc.toObject());
  }

  async findById(id: string): Promise<Meeting | null> {
    const doc = await this.model.findById(id).lean<MeetingDoc>();
    return doc ? toMeeting(doc) : null;
  }

  async patch(id: string, { errors, ...fields }: MeetingUpdate): Promise<void> {
    const $set: Record<string, unknown> = { ...fields };
    for (const [kind, message] of Object.entries(errors ?? {}))
      $set[`errors.${kind}`] = message;
    const res = await this.model.updateOne({ _id: id }, { $set });
    if (res.matchedCount === 0) throw new Error(`Meeting ${id} not found`);
  }
}
