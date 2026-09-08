-- AlterTable
ALTER TABLE "Video" ADD COLUMN "contentHash" TEXT;

-- CreateIndex
CREATE INDEX "Video_contentHash_idx" ON "Video"("contentHash");
