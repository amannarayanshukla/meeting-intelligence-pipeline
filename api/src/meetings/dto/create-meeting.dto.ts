import { IsString, Length } from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @Length(1, 200_000)
  transcript!: string;
}
