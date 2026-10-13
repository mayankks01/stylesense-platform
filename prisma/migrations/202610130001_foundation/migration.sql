-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SENT', 'DELIVERED', 'OPENED', 'REPLIED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('INTERESTED', 'NEEDS_INFO', 'NOT_NOW', 'WRONG_PERSON', 'UNSUBSCRIBE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "csrfToken" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "industry" VARCHAR(100),
    "region" VARCHAR(100),
    "size" INTEGER,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254),
    "title" VARCHAR(160),
    "sourceUrl" TEXT NOT NULL,
    "icp" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "icp" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "campaignId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("campaignId","leadId")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider" TEXT,
    "providerId" TEXT,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "messageId" UUID,
    "type" "EventType" NOT NULL,
    "intent" "ReplyIntent",
    "source" VARCHAR(100) NOT NULL,
    "dedupeKey" VARCHAR(128) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScore" (
    "leadId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "total" INTEGER NOT NULL,
    "fit" INTEGER NOT NULL,
    "engagement" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "configVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("leadId")
);

-- CreateTable
CREATE TABLE "ScoreHistory" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "triggerEventId" UUID,
    "previousTotal" INTEGER,
    "total" INTEGER NOT NULL,
    "fit" INTEGER NOT NULL,
    "engagement" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Company_ownerId_domain_key" ON "Company"("ownerId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "Company_id_ownerId_key" ON "Company"("id", "ownerId");

-- CreateIndex
CREATE INDEX "Lead_ownerId_createdAt_id_idx" ON "Lead"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_id_ownerId_key" ON "Lead"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_ownerId_email_key" ON "Lead"("ownerId", "email");

-- CreateIndex
CREATE INDEX "Campaign_ownerId_createdAt_id_idx" ON "Campaign"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_ownerId_key" ON "Campaign"("id", "ownerId");

-- CreateIndex
CREATE INDEX "CampaignLead_leadId_idx" ON "CampaignLead"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_leadId_ownerId_key" ON "CampaignLead"("campaignId", "leadId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_id_leadId_ownerId_key" ON "EmailMessage"("id", "leadId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_ownerId_idempotencyKey_key" ON "EmailMessage"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_provider_providerId_key" ON "EmailMessage"("provider", "providerId");

-- CreateIndex
CREATE INDEX "EmailEvent_ownerId_leadId_occurredAt_id_idx" ON "EmailEvent"("ownerId", "leadId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_ownerId_source_dedupeKey_key" ON "EmailEvent"("ownerId", "source", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_id_leadId_ownerId_key" ON "EmailEvent"("id", "leadId", "ownerId");

-- CreateIndex
CREATE INDEX "LeadScore_ownerId_total_leadId_idx" ON "LeadScore"("ownerId", "total", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadScore_leadId_ownerId_key" ON "LeadScore"("leadId", "ownerId");

-- CreateIndex
CREATE INDEX "ScoreHistory_ownerId_leadId_createdAt_id_idx" ON "ScoreHistory"("ownerId", "leadId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_ownerId_email_key" ON "Suppression"("ownerId", "email");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_ownerId_fkey" FOREIGN KEY ("companyId", "ownerId") REFERENCES "Company"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_ownerId_fkey" FOREIGN KEY ("campaignId", "ownerId") REFERENCES "Campaign"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_campaignId_leadId_ownerId_fkey" FOREIGN KEY ("campaignId", "leadId", "ownerId") REFERENCES "CampaignLead"("campaignId", "leadId", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_messageId_leadId_ownerId_fkey" FOREIGN KEY ("messageId", "leadId", "ownerId") REFERENCES "EmailMessage"("id", "leadId", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreHistory" ADD CONSTRAINT "ScoreHistory_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreHistory" ADD CONSTRAINT "ScoreHistory_triggerEventId_leadId_ownerId_fkey" FOREIGN KEY ("triggerEventId", "leadId", "ownerId") REFERENCES "EmailEvent"("id", "leadId", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that are not expressible in the Prisma schema.
ALTER TABLE "Company" ADD CONSTRAINT "company_size_positive" CHECK ("size" IS NULL OR "size" > 0);
ALTER TABLE "User" ADD CONSTRAINT "user_email_normalized" CHECK ("email" = lower(trim("email")));
ALTER TABLE "Lead" ADD CONSTRAINT "lead_email_normalized" CHECK ("email" IS NULL OR "email" = lower(trim("email")));
ALTER TABLE "Suppression" ADD CONSTRAINT "suppression_email_normalized" CHECK ("email" = lower(trim("email")));
ALTER TABLE "EmailEvent" ADD CONSTRAINT "reply_intent_consistent" CHECK (("type" = 'REPLIED' AND "intent" IS NOT NULL) OR ("type" <> 'REPLIED' AND "intent" IS NULL));
ALTER TABLE "LeadScore" ADD CONSTRAINT "lead_score_bounds" CHECK ("total" BETWEEN 0 AND 100);
ALTER TABLE "ScoreHistory" ADD CONSTRAINT "history_score_bounds" CHECK ("total" BETWEEN 0 AND 100 AND ("previousTotal" IS NULL OR "previousTotal" BETWEEN 0 AND 100));
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Events and score history are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER email_event_immutable BEFORE UPDATE OR DELETE ON "EmailEvent" FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER score_history_immutable BEFORE UPDATE OR DELETE ON "ScoreHistory" FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
