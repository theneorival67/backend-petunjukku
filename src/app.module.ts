import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import {
  appConfig,
  corsConfig,
  databaseConfig,
  storageConfig,
  supabaseConfig,
} from './config/app.config';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { SchoolModule } from './modules/school/school.module';
import { TeacherProfileModule } from './modules/teacher-profile/teacher-profile.module';
import { RppModule } from './modules/rpp/rpp.module';
import { StageModule } from './modules/stage/stage.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { UsersModule } from './modules/users/users.module';
import { AiModule } from './modules/ai/ai.module';
import { PlacesModule } from './modules/places/places.module';
import { RagModule } from './modules/rag/rag.module';
import { aiConfig } from './config/ai.config';
import { googleMapsConfig } from './config/google-maps.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [
        appConfig,
        corsConfig,
        supabaseConfig,
        databaseConfig,
        storageConfig,
        googleMapsConfig,
        aiConfig,
      ],
    }),
    PrismaModule,
    SupabaseModule,
    AuthModule,
    SchoolModule,
    TeacherProfileModule,
    RppModule,
    StageModule,
    WorkspaceModule,
    UsersModule,
    AiModule,
    PlacesModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
