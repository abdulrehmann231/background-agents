-- Backfill the signup grant onto accounts that predate it.
--
-- 20260904130000_add_credits adds User.creditBalanceMicroUsd with DEFAULT 0,
-- and gating is purely on that balance (lib/db/usage-limit: `credits > 0n`) now
-- that the daily allowance is gone. So every account that existed before this
-- deploy would land on zero and be unable to start a single shared-pool turn.
-- events.createUser only reaches accounts created from the deploy onwards.
--
-- scripts/grant-signup-credits.ts does the same thing by hand; this runs it as
-- part of the deploy so there is no window in which the whole existing user
-- base is locked out waiting for someone to remember the command.
--
-- Amount and key are duplicated from lib/server/credits (SIGNUP_CREDIT_USD = 0.25,
-- signupGrantKey) because SQL cannot import them. A migration is a historical
-- record of what was actually applied, so this figure is frozen at what the
-- grant was worth on the day it ran and must not be edited to follow later
-- changes to the constant.
--
-- It was edited once, from 5000000 to 250000, when credits stopped being
-- denominated in API list value and became discounted dollars. That was safe
-- only because this migration had never been applied anywhere at the time —
-- neither database's _prisma_migrations contained it, so there was no history
-- to misrepresent and no checksum to invalidate. Once deployed, the figure
-- above is history and the rule stands.
--
-- Selection mirrors the script's default (no --include-funded): skip anyone who
-- already has a signup grant, and skip anyone already funded — a non-zero
-- balance, or a purchase/grant/adjustment on the ledger. Both writes happen in
-- one data-modifying CTE so a balance can never move without the ledger row
-- that explains it.

WITH granted AS (
    UPDATE "User" u
    SET "creditBalanceMicroUsd" = u."creditBalanceMicroUsd" + 250000
    WHERE u."creditBalanceMicroUsd" = 0
      AND NOT EXISTS (
          SELECT 1
          FROM "CreditTransaction" t
          WHERE t."userId" = u."id"
            AND (
                t."externalId" = 'signup:' || u."id"
                OR t."type" IN ('purchase', 'grant', 'adjustment')
            )
      )
    RETURNING u."id", u."creditBalanceMicroUsd"
)
INSERT INTO "CreditTransaction" (
    "id",
    "userId",
    "amountMicroUsd",
    "balanceAfterMicroUsd",
    "type",
    "externalId",
    "description",
    "createdAt"
)
SELECT
    -- Derived from the user id rather than random, so the primary key is a
    -- third idempotency guard behind the unique "externalId" index and the
    -- NOT EXISTS above, and so this needs no uuid function.
    'signup_backfill_' || g."id",
    g."id",
    250000,
    g."creditBalanceMicroUsd",
    'grant',
    'signup:' || g."id",
    'Signup credit',
    CURRENT_TIMESTAMP
FROM granted g;
