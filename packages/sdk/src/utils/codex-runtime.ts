import { CODEX_CLI_VERSION } from "./install"
import { quote } from "./shell"

export const CODEX_RUNTIME_PREFIX = `/home/daytona/.local/share/background-agents/codex/${CODEX_CLI_VERSION}`

export function isSupportedCodexVersion(output: string): boolean {
  // Newer is not necessarily reviewed. Equality also makes a reverted pin
  // select the older runtime on sandboxes that already have the newer one.
  return output.trim() === `codex-cli ${CODEX_CLI_VERSION}`
}

/** Install beside the existing CLI, not over it: other jobs may still use it.
 * Publish the verified directory atomically, with a cross-process lock. Never
 * writes to auth.json, config.toml, model caches, or the project directory. */
export function codexRuntimeInstallCommand(): string {
  return `bash -c ${quote(`set -eu
target=${quote(CODEX_RUNTIME_PREFIX)}
mkdir -p "$(dirname "$target")"
exec 9>"$target.lock"
flock -w 120 9
if [ -x "$target/bin/codex" ] && [ "$("$target/bin/codex" --version)" = "codex-cli ${CODEX_CLI_VERSION}" ]; then exit 0; fi
# A previously published directory must not be overwritten in place.
if [ -e "$target" ]; then echo 'Codex runtime directory is damaged; administrator repair is required.' >&2; exit 1; fi
stage=$(mktemp -d "$target.install.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
npm install --global --prefix "$stage" @openai/codex@${CODEX_CLI_VERSION} --no-audit --no-fund
test "$("$stage/bin/codex" --version)" = "codex-cli ${CODEX_CLI_VERSION}"
mv "$stage" "$target"
trap - EXIT`)}`
}
