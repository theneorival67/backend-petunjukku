import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async getMe(authUser: AuthUser) {
    const user = await this.usersService.syncSupabaseUser(authUser);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
