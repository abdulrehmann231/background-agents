-- Uploaded skills keep their zip so they can be reinstalled in new sandboxes.
ALTER TABLE "Skill" ADD COLUMN "archive" BYTEA;
