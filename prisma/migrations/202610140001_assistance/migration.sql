-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "discoveryKey" VARCHAR(64);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "icp" JSONB NOT NULL,
    "requested" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "trace" JSONB NOT NULL DEFAULT '[]',
    "rejections" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryCandidate" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "data" JSONB NOT NULL,
    "importedLeadId" UUID,

    CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchFact" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "simulated" BOOLEAN NOT NULL,

    CONSTRAINT "ResearchFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyAnalysis" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "text" TEXT NOT NULL,
    "intent" "ReplyIntent" NOT NULL,
    "rationale" TEXT NOT NULL,
    "draft" TEXT,
    "reviewedDraft" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ReplyAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryRun_ownerId_createdAt_idx" ON "DiscoveryRun"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryRun_id_ownerId_key" ON "DiscoveryRun"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryRun_ownerId_idempotencyKey_key" ON "DiscoveryRun"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_ownerId_runId_idx" ON "DiscoveryCandidate"("ownerId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_runId_fingerprint_key" ON "DiscoveryCandidate"("runId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchFact_leadId_field_key" ON "ResearchFact"("leadId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyAnalysis_eventId_key" ON "ReplyAnalysis"("eventId");

-- CreateIndex
CREATE INDEX "ReplyAnalysis_ownerId_leadId_createdAt_idx" ON "ReplyAnalysis"("ownerId", "leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyAnalysis_eventId_leadId_ownerId_key" ON "ReplyAnalysis"("eventId", "leadId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyAnalysis_ownerId_idempotencyKey_key" ON "ReplyAnalysis"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_ownerId_discoveryKey_key" ON "Lead"("ownerId", "discoveryKey");

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_runId_ownerId_fkey" FOREIGN KEY ("runId", "ownerId") REFERENCES "DiscoveryRun"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_importedLeadId_ownerId_fkey" FOREIGN KEY ("importedLeadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchFact" ADD CONSTRAINT "ResearchFact_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyAnalysis" ADD CONSTRAINT "ReplyAnalysis_leadId_ownerId_fkey" FOREIGN KEY ("leadId", "ownerId") REFERENCES "Lead"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyAnalysis" ADD CONSTRAINT "ReplyAnalysis_eventId_leadId_ownerId_fkey" FOREIGN KEY ("eventId", "leadId", "ownerId") REFERENCES "EmailEvent"("id", "leadId", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "discovery_status" CHECK ("status" IN ('RUNNING','COMPLETE','PARTIAL','FAILED'));
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "discovery_count" CHECK ("requested" BETWEEN 5 AND 10);
ALTER TABLE "ReplyAnalysis" ADD CONSTRAINT "reply_review_status" CHECK ("status" IN ('PENDING_REVIEW','APPROVED','DISMISSED','SUPPRESSED'));
ALTER TABLE "ReplyAnalysis" ADD CONSTRAINT "reply_approval_text" CHECK ("status" <> 'APPROVED' OR ("reviewedDraft" IS NOT NULL AND "reviewedAt" IS NOT NULL));
