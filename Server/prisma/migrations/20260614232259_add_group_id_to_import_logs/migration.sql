-- AlterTable
ALTER TABLE "import_logs" ADD COLUMN     "group_id" UUID;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
