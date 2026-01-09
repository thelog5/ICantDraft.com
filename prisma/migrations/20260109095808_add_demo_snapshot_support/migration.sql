-- AlterTable
ALTER TABLE "League" ADD COLUMN     "demoSnapshotId" TEXT;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "demoSnapshotId" TEXT;

-- AlterTable
ALTER TABLE "RosterSlot" ADD COLUMN     "demoSnapshotId" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "demoSnapshotId" TEXT;

-- CreateTable
CREATE TABLE "DemoSnapshot" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceLeagueId" TEXT,

    CONSTRAINT "DemoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "League_demoSnapshotId_idx" ON "League"("demoSnapshotId");

-- CreateIndex
CREATE INDEX "Player_demoSnapshotId_idx" ON "Player"("demoSnapshotId");

-- CreateIndex
CREATE INDEX "RosterSlot_demoSnapshotId_idx" ON "RosterSlot"("demoSnapshotId");

-- CreateIndex
CREATE INDEX "Team_demoSnapshotId_idx" ON "Team"("demoSnapshotId");

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_demoSnapshotId_fkey" FOREIGN KEY ("demoSnapshotId") REFERENCES "DemoSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_demoSnapshotId_fkey" FOREIGN KEY ("demoSnapshotId") REFERENCES "DemoSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_demoSnapshotId_fkey" FOREIGN KEY ("demoSnapshotId") REFERENCES "DemoSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_demoSnapshotId_fkey" FOREIGN KEY ("demoSnapshotId") REFERENCES "DemoSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
