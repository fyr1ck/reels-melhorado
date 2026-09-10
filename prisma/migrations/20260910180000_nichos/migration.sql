-- Separação por nichos.
--
-- Só ADITIVO de propósito: três tabelas novas e cinco colunas novas em
-- Settings. Nenhuma tabela existente é reconstruída, nenhum dado é reescrito.
-- Se este recurso for desligado, tudo que já existe continua funcionando
-- exatamente como antes.

-- CreateTable
CREATE TABLE "Niche" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "subniches" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "bannedKeywords" TEXT NOT NULL DEFAULT '',
    "allowedThemes" TEXT NOT NULL DEFAULT '',
    "bannedThemes" TEXT NOT NULL DEFAULT '',
    "customRules" TEXT NOT NULL DEFAULT '',
    "audience" TEXT,
    "tone" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "strictness" TEXT NOT NULL DEFAULT 'MEDIO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountNiche" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountNiche_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountNiche_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "Niche" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentClassification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "nicheId" TEXT,
    "score" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SEM_CLASSIFICACAO',
    "scores" TEXT NOT NULL DEFAULT '[]',
    "reasons" TEXT NOT NULL DEFAULT '[]',
    "recommendedAccountId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'REGRAS',
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentClassification_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentClassification_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "Niche" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Niche_name_key" ON "Niche"("name");
CREATE INDEX "Niche_active_priority_idx" ON "Niche"("active", "priority");
CREATE INDEX "AccountNiche_nicheId_idx" ON "AccountNiche"("nicheId");
CREATE UNIQUE INDEX "AccountNiche_accountId_nicheId_key" ON "AccountNiche"("accountId", "nicheId");
CREATE UNIQUE INDEX "ContentClassification_videoId_key" ON "ContentClassification"("videoId");
CREATE INDEX "ContentClassification_status_idx" ON "ContentClassification"("status");
CREATE INDEX "ContentClassification_nicheId_idx" ON "ContentClassification"("nicheId");

-- AlterTable: colunas novas com padrão, então as linhas existentes já nascem
-- válidas e nada precisa ser reescrito.
ALTER TABLE "Settings" ADD COLUMN "nicheEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "nicheApproveScore" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "Settings" ADD COLUMN "nicheReviewScore" INTEGER NOT NULL DEFAULT 70;
ALTER TABLE "Settings" ADD COLUMN "nicheBlockPublish" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ADD COLUMN "nicheUseAi" BOOLEAN NOT NULL DEFAULT false;
