-- Purchased credits: a second balance behind the daily plan allowance.
--
-- Money is stored in micro-dollars (1e-6 USD) as BIGINT rather than as cents or
-- a float. Turn costs routinely run under a cent, so cents would either
-- overcharge (rounding up) or round to zero — the free-route-around-the-cap
-- case token-metering already guards against — and a float would inherit the
-- residue snapCostResidue exists to absorb.

ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN "creditBalanceMicroUsd" BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- Append-only ledger behind User.creditBalanceMicroUsd.
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMicroUsd" BIGINT NOT NULL,
    "balanceAfterMicroUsd" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT,
    "stripeEventId" TEXT,
    "stripePaymentIntentId" TEXT,
    "tokenUsageId" TEXT,
    "chatId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- Both unique indexes are idempotency guards, and both columns are nullable on
-- purpose: Postgres permits unlimited NULLs under a unique index, so rows that
-- key on one of them leave the other free.
CREATE UNIQUE INDEX "CreditTransaction_externalId_key" ON "CreditTransaction"("externalId");
CREATE UNIQUE INDEX "CreditTransaction_tokenUsageId_key" ON "CreditTransaction"("tokenUsageId");
CREATE INDEX "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId", "createdAt");
CREATE INDEX "CreditTransaction_type_createdAt_idx" ON "CreditTransaction"("type", "createdAt");

ALTER TABLE "CreditTransaction"
    ADD CONSTRAINT "CreditTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every Stripe webhook we have seen, keyed by Stripe's own event id so a
-- redelivery collides instead of crediting twice.
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StripeEvent_type_createdAt_idx" ON "StripeEvent"("type", "createdAt");
