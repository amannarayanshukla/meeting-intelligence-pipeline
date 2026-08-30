import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CreateMeetingDto } from './dto/create-meeting.dto.js';
import { MeetingStatusDto } from './dto/meeting-status.dto.js';
import { MeetingsService } from './meetings.service.js';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  @HttpCode(202)
  submit(@Body() dto: CreateMeetingDto): Promise<{ id: string }> {
    return this.meetings.submit(dto.transcript);
  }

  @Get(':id')
  async status(@Param('id') id: string): Promise<MeetingStatusDto> {
    const dto = await this.meetings.status(id);
    if (!dto) throw new NotFoundException(`Meeting ${id} not found`);
    return dto;
  }
}
