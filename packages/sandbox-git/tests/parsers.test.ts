/**
 * Pure unit tests for Git status parsing. These use porcelain output directly,
 * so they do not require a sandbox or Daytona credentials.
 */
import { describe, expect, it } from "vitest"
import { parseGitStatus } from "../src/parsers.js"

describe("parseGitStatus", () => {
  it("parses a local branch", () => {
    const status = parseGitStatus("## feature/login", "")

    expect(status.currentBranch).toBe("feature/login")
    expect(status.isPublished).toBe(false)
  })

  it("preserves periods in a local branch name", () => {
    const status = parseGitStatus("## release/v1.2.3", "")

    expect(status.currentBranch).toBe("release/v1.2.3")
    expect(status.isPublished).toBe(false)
  })

  it("separates a dotted branch name from its upstream", () => {
    const status = parseGitStatus(
      "## release/v1.2.3...origin/release/v1.2.3 [ahead 1, behind 2]",
      "2\t1"
    )

    expect(status.currentBranch).toBe("release/v1.2.3")
    expect(status.isPublished).toBe(true)
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(2)
  })

  it("parses an unborn dotted branch", () => {
    const status = parseGitStatus("## No commits yet on release/v1.2.3", "")

    expect(status.currentBranch).toBe("release/v1.2.3")
    expect(status.isPublished).toBe(false)
  })

  it("keeps the existing detached HEAD representation", () => {
    const status = parseGitStatus("## HEAD (no branch)", "")

    expect(status.currentBranch).toBe("HEAD")
    expect(status.isPublished).toBe(false)
  })
})
