-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "assistantEnabled" BOOLEAN NOT NULL DEFAULT false,
    "assistantApiKey" TEXT,
    "assistantModel" TEXT NOT NULL DEFAULT 'claude-sonnet-5',
    "assistantAutoApply" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanCache" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanEveryHours" INTEGER NOT NULL DEFAULT 24,
    "lastCacheCleanAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("autoCleanCache", "autoCleanEveryHours", "blockDuplicateContent", "defaultCaption", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "notifyOnSuccess", "telegramBotToken", "telegramChatId", "updatedAt", "useDefaultCover", "webhookUrl") SELECT "autoCleanCache", "autoCleanEveryHours", "blockDuplicateContent", "defaultCaption", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "notifyOnSuccess", "telegramBotToken", "telegramChatId", "updatedAt", "useDefaultCover", "webhookUrl" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
