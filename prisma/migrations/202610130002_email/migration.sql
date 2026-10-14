-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstAttemptAt" TIMESTAMP(3),
ADD COLUMN     "fromAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "groundingSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "html" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "leadEmailSnapshot" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "openTokenHash" VARCHAR(64),
ADD COLUMN     "requestFingerprint" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sendStatus" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "unsubscribeTokenHash" VARCHAR(64),
ADD COLUMN     "unsubscribeUrl" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "OutreachEvidence" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "token" VARCHAR(100) NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "excerpt" VARCHAR(4000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroundingLog" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroundingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachEvidence_ownerId_leadId_idx" ON "OutreachEvidence"("ownerId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachEvidence_leadId_token_key" ON "OutreachEvidence"("leadId", "token");

-- CreateIndex
CREATE INDEX "GroundingLog_ownerId_leadId_createdAt_idx" ON "GroundingLog"("ownerId", "leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_openTokenHash_key" ON "EmailMessage"("openTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_unsubscribeTokenHash_key" ON "EmailMessage"("unsubscribeTokenHash");

-- AddForeignKey
ALTER TABLE "OutreachEvidence" ADD CONSTRAINT "OutreachEvidence_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroundingLog" ADD CONSTRAINT "GroundingLog_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailMessage" ADD CONSTRAINT "message_send_status" CHECK ("sendStatus" IN ('DRAFT','SENDING','ACCEPTED','FAILED','UNCERTAIN','BLOCKED'));
ALTER TABLE "EmailMessage" ADD CONSTRAINT "message_attempts_nonnegative" CHECK ("attemptCount" >= 0);
CREATE FUNCTION protect_message_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."ownerId",NEW."campaignId",NEW."leadId",NEW."recipient",NEW."subject",NEW."body",NEW."html",NEW."fromAddress",NEW."provider",NEW."idempotencyKey",NEW."requestFingerprint",NEW."groundingSnapshot",NEW."leadEmailSnapshot",NEW."openTokenHash",NEW."unsubscribeTokenHash",NEW."unsubscribeUrl") IS DISTINCT FROM ROW(OLD."ownerId",OLD."campaignId",OLD."leadId",OLD."recipient",OLD."subject",OLD."body",OLD."html",OLD."fromAddress",OLD."provider",OLD."idempotencyKey",OLD."requestFingerprint",OLD."groundingSnapshot",OLD."leadEmailSnapshot",OLD."openTokenHash",OLD."unsubscribeTokenHash",OLD."unsubscribeUrl") THEN
    RAISE EXCEPTION 'Prepared message content is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."firstAttemptAt" IS NOT NULL AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt" THEN
    RAISE EXCEPTION 'First attempt time is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."providerId" IS NOT NULL AND NEW."providerId" IS DISTINCT FROM OLD."providerId" THEN
    RAISE EXCEPTION 'Provider message identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER message_snapshot_immutable BEFORE UPDATE ON "EmailMessage" FOR EACH ROW EXECUTE FUNCTION protect_message_snapshot();
