-- CreateTable
CREATE TABLE "AutoReplySetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updateAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoReplySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoReplySetting_userId_idx" ON "AutoReplySetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoReplySetting_userId_chatId_key" ON "AutoReplySetting"("userId", "chatId");
