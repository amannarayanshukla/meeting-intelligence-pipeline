import { Meeting, MeetingUpdate } from '../meeting.entity.js';

/** Abstract class (not interface) so it doubles as the Nest DI token. */
export abstract class MeetingRepository {
  abstract create(input: { transcript: string }): Promise<Meeting>;
  abstract findById(id: string): Promise<Meeting | null>;
  abstract patch(id: string, update: MeetingUpdate): Promise<void>;
}
