-- CreateEnum
CREATE TYPE "PersonalChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- AlterTable
ALTER TABLE "AutoReplySetting" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PersonalChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PersonalChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "intent" JSONB,
    "clientMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantRuleAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetChatId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantRuleAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalChatMessage_userId_createdAt_idx" ON "PersonalChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalChatMessage_userId_clientMessageId_key" ON "PersonalChatMessage"("userId", "clientMessageId");

-- CreateIndex
CREATE INDEX "AssistantRuleAuditLog_userId_targetChatId_idx" ON "AssistantRuleAuditLog"("userId", "targetChatId");
