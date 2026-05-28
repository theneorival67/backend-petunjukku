-- CreateTable
DO $$ BEGIN
    CREATE TYPE "ChatRole" AS ENUM ('user', 'assistant', 'system');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE "kina_thread_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rpp_project_id" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "metadata" JSONB,
    "tool_name" TEXT,
    "tool_state" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kina_thread_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kina_thread_messages_rpp_project_id_created_at_idx" ON "kina_thread_messages"("rpp_project_id", "created_at");

-- AddForeignKey
ALTER TABLE "kina_thread_messages" ADD CONSTRAINT "kina_thread_messages_rpp_project_id_fkey" FOREIGN KEY ("rpp_project_id") REFERENCES "rpp_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
