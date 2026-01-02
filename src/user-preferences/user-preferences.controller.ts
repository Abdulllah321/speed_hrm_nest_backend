import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserPreferencesService } from './user-preferences.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UpsertUserPreferenceDto } from './dto/user-preference.dto';

@ApiTags('User Preferences')
@Controller('api')
export class UserPreferencesController {
  constructor(private service: UserPreferencesService) {}

  @Get('user-preferences/:key')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user preference by key' })
  @ApiResponse({ status: 200, description: 'Preference retrieved successfully' })
  async get(@Req() req: any, @Param('key') key: string) {
    const userId = req.user?.userId;
    if (!userId) {
      return { status: false, message: 'User not authenticated' };
    }
    return this.service.get(userId, key);
  }

  @Post('user-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update user preference' })
  @ApiResponse({ status: 200, description: 'Preference saved successfully' })
  async upsert(@Req() req: any, @Body() body: UpsertUserPreferenceDto) {
    const userId = req.user?.userId;
    if (!userId) {
      return { status: false, message: 'User not authenticated' };
    }
    return this.service.upsert(userId, body.key, body.value);
  }
}

