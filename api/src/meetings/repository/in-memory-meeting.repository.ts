import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Meeting, MeetingUpdate } from '../meeting.entity.js';
import { MeetingRepository } from './meeting.repository.js';

@Injectable()
export class InMemoryMeetingRepository extends MeetingRepository {
  private readonly store = new Map<string, Meeting>();

  async create({ transcript }: { transcript: string }): Promise<Meeting> {
    const m: Meeting = {
      id: randomUUID(),
      transcript,
      summary: null,
      actions: null,
      vector: null,
      errors: {},
      createdAt: new Date(),
    };
    this.store.set(m.id, m);
    return structuredClone(m);
  }

  async findById(id: string): Promise<Meeting | null> {
    const m = this.store.get(id);
    return m ? structuredClone(m) : null;
  }

  async patch(id: string, { errors, ...fields }: MeetingUpdate): Promise<void> {
    const m = this.store.get(id);
    if (!m) throw new Error(`Meeting ${id} not found`);
    Object.assign(m, fields);
    if (errors) Object.assign(m.errors, errors);
  }
}
