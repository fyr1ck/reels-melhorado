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
INSERT INTO "new_Account" ("connected", "createdAt", "defaultCoverPath", "enabled", "fallbackCaption", "id", "intervalMinutes", "isDefault", "label", "lastConnectedAt", "randomOrder", "scheduleMode", "sortOrder", "status", "updatedAt", "useDefaultCover", "username") SELECT "connected", "createdAt", "defaultCoverPath", "enabled", "fallbackCaption", "id", "intervalMinutes", "isDefault", "label", "lastConnectedAt", "randomOrder", "scheduleMode", "sortOrder", "status", "updatedAt", "useDefaultCover", "username" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");
CREATE INDEX "Account_enabled_status_idx" ON "Account"("enabled", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
