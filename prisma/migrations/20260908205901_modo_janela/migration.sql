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
    "postsPerDay" INTEGER NOT NULL DEFAULT 20,
    "windowStart" TEXT NOT NULL DEFAULT '07:00',
    "windowEnd" TEXT NOT NULL DEFAULT '23:00',
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
INSERT INTO "new_Account" ("connected", "createdAt", "dailyLimit", "defaultCoverPath", "enabled", "fallbackCaption", "id", "intervalMinutes", "isDefault", "label", "lastConnectedAt", "quietEnd", "quietStart", "randomOrder", "recycleAfterDays", "recycleEnabled", "recycleMaxTimes", "scheduleMode", "sortOrder", "status", "updatedAt", "useDefaultCover", "username", "warmupDays", "warmupStartAt", "warmupTarget") SELECT "connected", "createdAt", "dailyLimit", "defaultCoverPath", "enabled", "fallbackCaption", "id", "intervalMinutes", "isDefault", "label", "lastConnectedAt", "quietEnd", "quietStart", "randomOrder", "recycleAfterDays", "recycleEnabled", "recycleMaxTimes", "scheduleMode", "sortOrder", "status", "updatedAt", "useDefaultCover", "username", "warmupDays", "warmupStartAt", "warmupTarget" FROM "Account";
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
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappNumber" TEXT,
    "whatsappHeadless" BOOLEAN NOT NULL DEFAULT true,
    "assistantEnabled" BOOLEAN NOT NULL DEFAULT false,
    "assistantApiKey" TEXT,
    "assistantModel" TEXT NOT NULL DEFAULT 'claude-sonnet-5',
    "assistantAutoApply" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanCache" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanEveryHours" INTEGER NOT NULL DEFAULT 24,
    "lastCacheCleanAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("assistantApiKey", "assistantAutoApply", "assistantEnabled", "assistantModel", "autoCleanCache", "autoCleanEveryHours", "blockDuplicateContent", "defaultCaption", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "notifyOnSuccess", "telegramBotToken", "telegramChatId", "updatedAt", "useDefaultCover", "webhookUrl", "whatsappEnabled", "whatsappNumber") SELECT "assistantApiKey", "assistantAutoApply", "assistantEnabled", "assistantModel", "autoCleanCache", "autoCleanEveryHours", "blockDuplicateContent", "defaultCaption", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "notifyOnSuccess", "telegramBotToken", "telegramChatId", "updatedAt", "useDefaultCover", "webhookUrl", "whatsappEnabled", "whatsappNumber" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
