import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;
  private readonly adminClient: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('supabase.url');
    const anonKey = this.configService.getOrThrow<string>('supabase.anonKey');
    const serviceRoleKey = this.configService.getOrThrow<string>(
      'supabase.serviceRoleKey',
    );

    // Client biasa
    this.client = createClient(url, anonKey);

    // Admin client — bypass RLS, hanya untuk internal server logic
    this.adminClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }
}
