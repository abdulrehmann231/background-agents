-- Tiers are gone: every account is gated on its credit balance and refilled to
-- the same daily target. Former `unlimited` accounts were granted credits by
-- hand before this ran.
ALTER TABLE "User" DROP COLUMN "plan";

DROP TYPE "Plan";
