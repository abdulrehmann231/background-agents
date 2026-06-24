-- User-defined custom endpoints (the "Custom endpoints" settings tab).
-- JSONB array of { id, name, type, baseUrl, model, headers }, where `headers`
-- is encrypted at rest. Replaces the old flat CUSTOM_* credential keys, which
-- were never released, so no data migration is needed.
ALTER TABLE "User" ADD COLUMN "customEndpoints" JSONB;
