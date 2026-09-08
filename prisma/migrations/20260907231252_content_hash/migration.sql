-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "keepBrowserOpen" BOOLEAN NOT NULL DEFAULT false,
    "blockDuplicateContent" BOOLEAN NOT NULL DEFAULT true,
    "defaultCoverPath" TEXT,
    "useDefaultCover" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanCache" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanEveryHours" INTEGER NOT NULL DEFAULT 24,
    "lastCacheCleanAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("autoCleanCache", "autoCleanEveryHours", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "updatedAt", "useDefaultCover") SELECT "autoCleanCache", "autoCleanEveryHours", "defaultCoverPath", "id", "keepBrowserOpen", "lastCacheCleanAt", "updatedAt", "useDefaultCover" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
