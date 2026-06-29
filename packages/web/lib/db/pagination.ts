/**
 * Shared pagination helpers for paginated API routes.
 *
 * Centralizes the `page`/`limit` query-param parsing (with sane bounds) and the
 * `pagination` response envelope so paginated routes don't each re-implement the
 * same arithmetic — and can't drift in how they clamp or round.
 */

export interface PaginationParams {
  /** 1-based page number (>= 1). */
  page: number
  /** Items per page, clamped to [1, maxLimit]. */
  limit: number
  /** Rows to skip for this page: (page - 1) * limit. */
  skip: number
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

/**
 * Parses `page` and `limit` from request query params.
 *
 * - `page` defaults to 1 and is floored at 1.
 * - `limit` defaults to `defaultLimit` and is clamped to [1, maxLimit].
 */
export function parsePaginationParams(
  searchParams: URLSearchParams,
  { defaultLimit = 50, maxLimit = 100 }: { defaultLimit?: number; maxLimit?: number } = {}
): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(searchParams.get("limit") || String(defaultLimit), 10))
  )
  return { page, limit, skip: (page - 1) * limit }
}

/**
 * Builds the `pagination` envelope returned alongside a page of results.
 */
export function buildPagination(page: number, limit: number, total: number): Pagination {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }
}
