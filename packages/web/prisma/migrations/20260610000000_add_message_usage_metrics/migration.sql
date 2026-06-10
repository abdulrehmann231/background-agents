-- Add per-turn token usage & cost (from tokscale) to assistant messages.
ALTER TABLE "Message" ADD COLUMN "usageMetrics" JSONB;
