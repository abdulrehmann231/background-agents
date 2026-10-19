-- Rename to match the app's "reasoning effort" terminology; same column, same semantics.
ALTER TABLE "QueuedPrompt" RENAME COLUMN "thinking" TO "reasoningEffort";
