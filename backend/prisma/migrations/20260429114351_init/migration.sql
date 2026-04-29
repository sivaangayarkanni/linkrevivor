-- CreateEnum
CREATE TYPE "LinkType" AS ENUM ('DOCUMENTATION', 'BLOG_POST', 'GITHUB_REPO', 'PDF', 'VIDEO', 'TOOL', 'PACKAGE', 'NEWS', 'FORUM', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ErrorType" AS ENUM ('HTTP_404', 'HTTP_410', 'HTTP_5XX', 'TIMEOUT', 'DNS_FAILURE', 'SSL_ERROR', 'CONNECTION_REFUSED', 'REDIRECT_LOOP');

-- CreateEnum
CREATE TYPE "AlternativeSource" AS ENUM ('GOOGLE_SEARCH', 'GITHUB_SEARCH', 'WAYBACK_SUGGESTION', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "linkType" "LinkType" NOT NULL DEFAULT 'UNKNOWN',
    "title" TEXT,
    "lastStatus" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkCheck" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "statusCode" INTEGER,
    "errorType" "ErrorType",
    "errorDetail" TEXT,
    "responseMs" INTEGER NOT NULL,
    "hasArchive" BOOLEAN NOT NULL DEFAULT false,
    "archiveUrl" TEXT,
    "archiveTimestamp" TIMESTAMP(3),
    "archiveSnapshotCount" INTEGER,
    "aiSummary" TEXT,
    "aiOutdatedScore" DOUBLE PRECISION,
    "aiRecommendation" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alternative" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT,
    "source" "AlternativeSource" NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alternative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkScan" (
    "id" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "totalLinks" INTEGER NOT NULL DEFAULT 0,
    "checkedLinks" INTEGER NOT NULL DEFAULT 0,
    "brokenLinks" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkScanItem" (
    "id" TEXT NOT NULL,
    "bulkScanId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "anchorText" TEXT,
    "statusCode" INTEGER,
    "isBroken" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BulkScanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Link_url_key" ON "Link"("url");

-- CreateIndex
CREATE UNIQUE INDEX "Link_urlHash_key" ON "Link"("urlHash");

-- CreateIndex
CREATE INDEX "Link_domain_idx" ON "Link"("domain");

-- CreateIndex
CREATE INDEX "Link_isAlive_idx" ON "Link"("isAlive");

-- CreateIndex
CREATE INDEX "Link_lastCheckedAt_idx" ON "Link"("lastCheckedAt");

-- CreateIndex
CREATE INDEX "LinkCheck_linkId_idx" ON "LinkCheck"("linkId");

-- CreateIndex
CREATE INDEX "LinkCheck_checkedAt_idx" ON "LinkCheck"("checkedAt");

-- CreateIndex
CREATE INDEX "Alternative_linkId_relevanceScore_idx" ON "Alternative"("linkId", "relevanceScore" DESC);

-- CreateIndex
CREATE INDEX "BulkScan_status_idx" ON "BulkScan"("status");

-- CreateIndex
CREATE INDEX "BulkScan_createdAt_idx" ON "BulkScan"("createdAt");

-- CreateIndex
CREATE INDEX "BulkScanItem_bulkScanId_idx" ON "BulkScanItem"("bulkScanId");

-- AddForeignKey
ALTER TABLE "LinkCheck" ADD CONSTRAINT "LinkCheck_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alternative" ADD CONSTRAINT "Alternative_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkScanItem" ADD CONSTRAINT "BulkScanItem_bulkScanId_fkey" FOREIGN KEY ("bulkScanId") REFERENCES "BulkScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkScanItem" ADD CONSTRAINT "BulkScanItem_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
