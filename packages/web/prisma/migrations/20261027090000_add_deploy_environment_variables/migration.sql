-- Deployment env vars (Environment Variables → Deployment), stored like repoEnvironmentVariables.
ALTER TABLE "User" ADD COLUMN "deployEnvironmentVariables" JSONB;
