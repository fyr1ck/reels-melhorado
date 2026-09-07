-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "label" TEXT,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "lastConnectedAt" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "scheduleMode" TEXT NOT NULL DEFAULT 'TIMES',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "randomOrder" BOOLEAN NOT NULL DEFAULT false,
    "fallbackCaption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "caption" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'REEL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "durationSec" REAL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "coverPath" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "failedAt" DATETIME,
    CONSTRAINT "Video_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Publication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Publication_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'REEL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "jitterMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Slot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Caption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HashtagSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mediaType" TEXT NOT NULL DEFAULT 'REEL',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cancelled" INTEGER NOT NULL DEFAULT 0,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "autoQueue" BOOLEAN NOT NULL DEFAULT true,
    "autoSchedule" BOOLEAN NOT NULL DEFAULT false,
    "varyOutputs" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "Batch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Batch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BatchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "outputName" TEXT,
    "outputPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "queuedVideoId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "BatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BatchItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceVideo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "durationSec" REAL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WatchFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'COPY',
    "mediaType" TEXT NOT NULL DEFAULT 'REEL',
    "autoCaption" BOOLEAN NOT NULL DEFAULT false,
    "lastScanAt" DATETIME,
    "lastError" TEXT,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WatchFolder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchFolderId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mtimeMs" INTEGER NOT NULL,
    "videoId" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedFile_watchFolderId_fkey" FOREIGN KEY ("watchFolderId") REFERENCES "WatchFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportedFile_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "keepBrowserOpen" BOOLEAN NOT NULL DEFAULT false,
    "defaultCoverPath" TEXT,
    "useDefaultCover" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanCache" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanEveryHours" INTEGER NOT NULL DEFAULT 24,
    "lastCacheCleanAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "action" TEXT NOT NULL,
    "message" TEXT,
    "accountId" TEXT,
    "videoName" TEXT,
    "attempt" INTEGER,
    "durationMs" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE INDEX "Account_enabled_status_idx" ON "Account"("enabled", "status");

-- CreateIndex
CREATE INDEX "Video_accountId_status_mediaType_idx" ON "Video"("accountId", "status", "mediaType");

-- CreateIndex
CREATE INDEX "Video_accountId_sortOrder_idx" ON "Video"("accountId", "sortOrder");

-- CreateIndex
CREATE INDEX "Publication_accountId_status_scheduledAt_idx" ON "Publication"("accountId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Publication_status_scheduledAt_idx" ON "Publication"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Slot_accountId_enabled_idx" ON "Slot"("accountId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_accountId_time_mediaType_key" ON "Slot"("accountId", "time", "mediaType");

-- CreateIndex
CREATE INDEX "Caption_enabled_usedCount_idx" ON "Caption"("enabled", "usedCount");

-- CreateIndex
CREATE INDEX "HashtagSet_enabled_usedCount_idx" ON "HashtagSet"("enabled", "usedCount");

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- CreateIndex
CREATE INDEX "BatchItem_batchId_status_idx" ON "BatchItem"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WatchFolder_path_key" ON "WatchFolder"("path");

-- CreateIndex
CREATE INDEX "WatchFolder_enabled_idx" ON "WatchFolder"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedFile_videoId_key" ON "ImportedFile"("videoId");

-- CreateIndex
CREATE INDEX "ImportedFile_watchFolderId_idx" ON "ImportedFile"("watchFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedFile_watchFolderId_sourcePath_sizeBytes_mtimeMs_key" ON "ImportedFile"("watchFolderId", "sourcePath", "sizeBytes", "mtimeMs");

-- CreateIndex
CREATE INDEX "LogEntry_createdAt_idx" ON "LogEntry"("createdAt");

-- CreateIndex
CREATE INDEX "LogEntry_level_createdAt_idx" ON "LogEntry"("level", "createdAt");
