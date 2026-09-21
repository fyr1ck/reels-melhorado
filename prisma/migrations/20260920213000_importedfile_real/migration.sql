-- sizeBytes e mtimeMs viram REAL.
--
-- O schema.prisma já dizia Float, mas a migration nunca foi escrita: a coluna
-- continuava INTEGER de 32 bits no banco, e toda importação morria em
-- "Value 1789960666000 does not fit in an INT column". SQLite não altera tipo
-- de coluna, então é o caminho padrão: tabela nova, copia, troca.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ImportedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchFolderId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sizeBytes" REAL NOT NULL,
    "mtimeMs" REAL NOT NULL,
    "videoId" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedFile_watchFolderId_fkey" FOREIGN KEY ("watchFolderId") REFERENCES "WatchFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportedFile_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ImportedFile" ("id", "watchFolderId", "sourcePath", "sizeBytes", "mtimeMs", "videoId", "importedAt")
SELECT "id", "watchFolderId", "sourcePath", "sizeBytes", "mtimeMs", "videoId", "importedAt" FROM "ImportedFile";

DROP TABLE "ImportedFile";
ALTER TABLE "new_ImportedFile" RENAME TO "ImportedFile";

CREATE UNIQUE INDEX "ImportedFile_videoId_key" ON "ImportedFile"("videoId");
CREATE INDEX "ImportedFile_watchFolderId_idx" ON "ImportedFile"("watchFolderId");
CREATE UNIQUE INDEX "ImportedFile_watchFolderId_sourcePath_sizeBytes_mtimeMs_key" ON "ImportedFile"("watchFolderId", "sourcePath", "sizeBytes", "mtimeMs");

PRAGMA foreign_keys=ON;
