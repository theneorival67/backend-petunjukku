import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';

@ApiTags('auth')
@ApiBearerAuth('supabase')
@Controller('auth')
export class AuthController {
  @ApiOperation({ summary: 'Ambil user dari Supabase access token' })
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
