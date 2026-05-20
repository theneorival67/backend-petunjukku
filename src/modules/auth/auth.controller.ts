import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';

@Controller('auth')
export class AuthController {
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
