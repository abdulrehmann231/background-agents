-- AlterTable
ALTER TABLE "TokenUsage" ADD COLUMN "keyId" TEXT;

-- CreateIndex
CREATE INDEX "TokenUsage_provider_keyId_createdAt_idx" ON "TokenUsage"("provider", "keyId", "createdAt");
