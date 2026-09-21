-- Legenda rotativa por conta: a cada N publicações o assistente reescreve a
-- legenda padrão a partir do modelo guardado em captionSeed.
ALTER TABLE "Account" ADD COLUMN "captionRotateEvery" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "captionRotateCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "captionSeed" TEXT;
