-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
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
    "recycleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recycleAfterDays" INTEGER NOT NULL DEFAULT 30,
    "recycleMaxTimes" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER NOT NULL DEFAULT 0,
    "quietStart" TEXT,
    "quietEnd" TEXT,
    "warmupStartAt" DATETIME,
    "warmupDays" INTEGER NOT NULL DEFAULT 14,
    "warmupTarget" INTEGER NOT NULL DEFAULT 6,
    "fallbackCaption" TEXT,
    "defaultCoverPath" TEXT,
    "useDefaultCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Account" ("connected", "createdAt", "dailyLimit", "defaultCoverPath", "enabled", "fallbackCaption", "id", "intervalMinutes", "isDefault", "label", "lastConnectedAt", "quietEnd", "quietStart", "randomOrder", "scheduleMode", "sortOrder", "status", "updatedAt", "useDefaultCover", "username", "warmupDays", "warmupStartAt", "warmupTarget") SELECT "connected", "createdAt", "dailyLimit", "defaultCoverPath", "enabled", "fallbackCaption", "id", "intervalMinutes", "isDefault", "label", "lastConnectedAt", "quietEnd", "quietStart", "randomOrder", "scheduleMode", "sortOrder", "status", "updatedAt", "useDefaultCover", "username", "warmupDays", "warmupStartAt", "warmupTarget" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");
CREATE INDEX "Account_enabled_status_idx" ON "Account"("enabled", "status");
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "keepBrowserOpen" BOOLEAN NOT NULL DEFAULT false,
    "blockDuplicateContent" BOOLEAN NOT NULL DEFAULT true,
    "defaultCaption" TEXT,
    "defaultCoverPath" TEXT,
    "useDefaultCover" BOOLEAN NOT NULL DEFAULT false,
    "telegramBotToken" TEXT,
    "telegramChatId" TEXT,
    "webhookUrl" TEXT,
    "notifyOnSuccess" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanCache" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanEveryHours" INTEGER NOT NULL DEFAULT 24,
    "lastCacheCleanAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("autoCleanCache", "autoCleanEveryHours", "blockDuplicateContent", "defaultCaption", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "updatedAt", "useDefaultCover") SELECT "autoCleanCache", "autoCleanEveryHours", "blockDuplicateContent", "defaultCaption", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "updatedAt", "useDefaultCover" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE TABLE "new_Video" (
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
    "contentHash" TEXT,
    "recycleCount" INTEGER NOT NULL DEFAULT 0,
    "lastRecycledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "failedAt" DATETIME,
    CONSTRAINT "Video_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Video" ("accountId", "caption", "contentHash", "coverPath", "createdAt", "durationSec", "failedAt", "filename", "filepath", "height", "id", "mediaType", "publishedAt", "sizeBytes", "sortOrder", "status", "width") SELECT "accountId", "caption", "contentHash", "coverPath", "createdAt", "durationSec", "failedAt", "filename", "filepath", "height", "id", "mediaType", "publishedAt", "sizeBytes", "sortOrder", "status", "width" FROM "Video";
DROP TABLE "Video";
ALTER TABLE "new_Video" RENAME TO "Video";
CREATE INDEX "Video_accountId_status_mediaType_idx" ON "Video"("accountId", "status", "mediaType");
CREATE INDEX "Video_accountId_sortOrder_idx" ON "Video"("accountId", "sortOrder");
CREATE INDEX "Video_contentHash_idx" ON "Video"("contentHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
