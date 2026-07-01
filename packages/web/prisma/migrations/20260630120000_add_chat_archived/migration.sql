-- Archived chats are hidden from the main sidebar list (shown in a separate
-- "Archived" section) but otherwise fully preserved, including their public
-- share link. Distinct from deletion, which is permanent.
ALTER TABLE "Chat" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- Index the (userId, archived) pair to keep the active-vs-archived split cheap.
CREATE INDEX "Chat_userId_archived_idx" ON "Chat"("userId", "archived");
