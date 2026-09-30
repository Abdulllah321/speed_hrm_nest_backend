import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('search')
@Controller('api/search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Global search across multiple entities' })
  @ApiQuery({ name: 'q', description: 'Search query string' })
  async search(@Query('q') query: string) {
    if (!query || query.length < 2) {
      return { status: true, data: [] };
    }
    const results = await this.searchService.globalSearch(query);
    return { status: true, data: results };
  }
}
