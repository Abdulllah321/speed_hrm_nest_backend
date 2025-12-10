/*
  Warnings:

  - You are about to drop the column `lat` on the `City` table. All the data in the column will be lost.
  - You are about to drop the column `lng` on the `City` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name,countryId,stateId]` on the table `City` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `stateId` to the `City` table without a default value. This is not possible if the table is not empty.
  - Made the column `countryId` on table `City` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "City" DROP CONSTRAINT "City_countryId_fkey";

-- DropIndex
DROP INDEX "City_name_countryId_key";

-- AlterTable
ALTER TABLE "City" DROP COLUMN "lat",
DROP COLUMN "lng",
ADD COLUMN     "stateId" TEXT NOT NULL,
ALTER COLUMN "countryId" SET NOT NULL;

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "City_name_countryId_stateId_key" ON "City"("name", "countryId", "stateId");

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "State" ADD CONSTRAINT "State_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "State" ADD CONSTRAINT "State_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
