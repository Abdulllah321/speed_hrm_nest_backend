/*
  Warnings:

  - You are about to drop the column `code` on the `Country` table. All the data in the column will be lost.
  - Added the required column `iso` to the `Country` table without a default value. This is not possible if the table is not empty.
  - Added the required column `iso3` to the `Country` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nicename` to the `Country` table without a default value. This is not possible if the table is not empty.
  - Added the required column `numcode` to the `Country` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phoneCode` to the `Country` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Country" DROP COLUMN "code",
ADD COLUMN     "iso" TEXT NOT NULL,
ADD COLUMN     "iso3" TEXT NOT NULL,
ADD COLUMN     "nicename" TEXT NOT NULL,
ADD COLUMN     "numcode" INTEGER NOT NULL,
ADD COLUMN     "phoneCode" INTEGER NOT NULL;
