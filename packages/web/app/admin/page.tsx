"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Users,
  MessageSquare,
  Activity,
  Clock,
  Trophy,
  LayoutDashboard,
  KeyRound,
  Menu,
  X,
  ArrowLeft,
  BarChart3,
  Wallet,
  SlidersHorizontal,
} from "lucide-react"
import { ActivityFeed } from "@/components/admin/ActivityFeed"
import { ClaudeCredentials } from "@/components/admin/ClaudeCredentials"
import { UserTable, type SortField, type SortOrder } from "@/components/admin/UserTable"
import { UserGrowthChart } from "@/components/admin/charts/UserGrowthChart"
import { MessagesByModelChart } from "@/components/admin/charts/MessagesByModelChart"
import { TopUsersTable } from "@/components/admin/TopUsersTable"
import { HourlyActivityChart } from "@/components/admin/charts/HourlyActivityChart"
import { DailyMessagesChatsChart } from "@/components/admin/charts/DailyMessagesChatsChart"
import { UsageDistributionChart } from "@/components/admin/charts/UsageDistributionChart"
import { PoolSplitChart } from "@/components/admin/charts/PoolSplitChart"
import { UsageByKeyChart } from "@/components/admin/charts/UsageByKeyChart"
import { LimitSimulator } from "@/components/admin/charts/LimitSimulator"
import { activeUserDays, percentiles } from "@/lib/admin/usage-distribution"
import {
  useAdminStatsQuery,
  useAdminActivityQuery,
  useAdminUsersQuery,
  useUpdateUserMutation,
  useUsageDistributionQuery,
  type StatsTimeRange,
  type StatsPool,
  type UsageProvider,
  type UsageRange,
} from "@/lib/query/hooks"
import { metricLabel, type StatsMetric } from "@/components/admin/charts/chartFormatters"
import { cn } from "@/lib/utils"

const METRIC_OPTIONS: { key: StatsMetric; label: string }[] = [
  { key: "tokens", label: "Tokens" },
  { key: "cost", label: "Cost" },
  { key: "messages", label: "Messages" },
]

// Credential-pool scope. "Shared" (the default) is what the platform actually
// pays for; "Own key" is usage on credentials the user supplied, which costs us
// nothing. Only meaningful for the ledger-backed metrics — see POOL_DISABLED_HINT.
const POOL_OPTIONS: { key: StatsPool; label: string; hint: string }[] = [
  { key: "shared", label: "Shared", hint: "Usage on our credential pools — what the platform pays for" },
  { key: "user", label: "Own key", hint: "Usage on credentials users supplied themselves — costs us nothing" },
  { key: "all", label: "All", hint: "Both pools combined" },
]

const POOL_DISABLED_HINT =
  "Message counts come from the activity log, which has no credential-pool dimension. Switch to Tokens or Cost to filter by pool."

// Providers with a shared pool and a configured budget. Each is metered in its
// own unit (tokens / USD / messages), so the distribution charts are scoped to
// one provider at a time rather than sharing an axis.
const USAGE_PROVIDERS: { key: UsageProvider; label: string }[] = [
  { key: "opencode", label: "OpenCode" },
  { key: "claude", label: "Claude" },
  { key: "gemini", label: "Gemini" },
]

type SectionKey = "overview" | "users" | "activity" | "credentials"

const sections: { key: SectionKey; label: string; icon: typeof Users }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "users", label: "Users", icon: Users },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "credentials", label: "Credentials", icon: KeyRound },
]

export default function AdminDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // Navigation state
  const [activeSection, setActiveSection] = useState<SectionKey>("overview")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // User table state
  const [usersPage, setUsersPage] = useState(1)
  const [usersSearch, setUsersSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("createdAt")
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc")

  // Activity state
  const [activityPage, setActivityPage] = useState(1)
  const [activityFilters, setActivityFilters] = useState<{
    action?: string
    agent?: string
    model?: string
    dateFrom?: string
    dateTo?: string
  }>({})

  // Global time range state (affects all charts)
  const [globalTimeRange, setGlobalTimeRange] = useState<StatsTimeRange>("7d")
  // Include admin users' activity in the overview stats (default off)
  const [includeAdmins, setIncludeAdmins] = useState(false)
  // Primary metric the overview charts are weighted by (default tokens)
  const [metric, setMetric] = useState<StatsMetric>("tokens")
  // Credential pool the ledger-backed charts are scoped to (default shared, so
  // the dashboard reports platform spend rather than a BYOK-inflated total).
  const [pool, setPool] = useState<StatsPool>("shared")
  // ActivityLog has no pool column, so the filter can't apply to message counts.
  const poolFilterDisabled = metric === "messages"
  // Send "all" while disabled so the server isn't handed a filter the UI is not
  // actually offering — keeps the response consistent with what's on screen.
  const effectivePool: StatsPool = poolFilterDisabled ? "all" : pool

  // Provider for the usage-distribution block (its own selector — the metric
  // toggle above doesn't apply, since each provider has its own budget unit).
  const [usageProvider, setUsageProvider] = useState<UsageProvider>("opencode")
  // The distribution view is day-bucketed, so it has no "all" range. Follow the
  // global range where it can and fall back to 30d for "all".
  const usageRange: UsageRange = globalTimeRange === "all" ? "30d" : globalTimeRange

  // Queries - pass globalTimeRange to stats query
  const statsQuery = useAdminStatsQuery(globalTimeRange, !includeAdmins, metric, effectivePool)
  const usageQuery = useUsageDistributionQuery(usageRange, usageProvider, !includeAdmins)
  const activityQuery = useAdminActivityQuery({
    page: activityPage,
    limit: 20,
    ...activityFilters,
    includeFilters: true,
  })
  const usersQuery = useAdminUsersQuery({
    page: usersPage,
    search: usersSearch || undefined,
    sortField,
    sortOrder,
  })
  const updateUserMutation = useUpdateUserMutation()

  // Handle sort change
  const handleSortChange = (field: SortField) => {
    if (field === sortField) {
      // Toggle order if clicking same field
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      // New field, default to desc
      setSortField(field)
      setSortOrder("desc")
    }
    setUsersPage(1) // Reset to first page on sort change
  }

  // Redirect if not authenticated or forbidden
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
    }
  }, [status, router])

  // Handle 403 errors by redirecting
  useEffect(() => {
    const isForbidden =
      statsQuery.error?.message?.includes("Forbidden") ||
      activityQuery.error?.message?.includes("Forbidden") ||
      usersQuery.error?.message?.includes("Forbidden")

    if (isForbidden) {
      router.push("/")
    }
  }, [statsQuery.error, activityQuery.error, usersQuery.error, router])

  // Loading state with skeleton
  if (status === "loading" || statsQuery.isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        {/* Skeleton Sidebar */}
        <aside className="hidden md:block w-56 shrink-0 border-r bg-card">
          <div className="p-4">
            <div className="h-7 w-20 bg-muted animate-pulse rounded mb-6" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          </div>
        </aside>
        {/* Skeleton Content */}
        <main className="flex-1 p-4 md:p-8">
          <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="h-7 w-28 bg-muted animate-pulse rounded" />
              <div className="flex gap-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 w-20 bg-muted animate-pulse rounded-md" />
                ))}
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg border bg-card p-6">
                  <div className="h-5 w-40 bg-muted animate-pulse rounded mb-4" />
                  <div className="h-[250px] bg-muted/50 animate-pulse rounded" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Not authenticated
  if (status === "unauthenticated") {
    return null
  }

  const weeklyActiveUsers = statsQuery.data?.weeklyActiveUsers ?? []
  const topUsers = statsQuery.data?.topUsers ?? []
  const hourly = statsQuery.data?.hourly ?? []
  const series = statsQuery.data?.series ?? []
  const byAgent = statsQuery.data?.byAgent ?? []
  const byModel = statsQuery.data?.byModel ?? []
  const isHourly = globalTimeRange === "24h"
  const metricName = metricLabel(metric)

  // Usage-distribution derivations. `activeUserDays` flattens the per-user matrix
  // into the sample a daily cap would actually apply to (idle days excluded).
  const usage = usageQuery.data
  const usageUnit = usage?.unit ?? "cost"
  const perUser = usage?.perUser ?? []
  const usageSample = activeUserDays(perUser)
  const usageStats = percentiles(usageSample)

  // Handle section change with mobile menu close
  const handleSectionChange = (section: SectionKey) => {
    setActiveSection(section)
    setMobileMenuOpen(false)
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center border-b bg-card px-4 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <h1 className="flex-1 text-center text-lg font-semibold">Admin</h1>
        {/* Spacer to balance the hamburger menu and keep title centered */}
        <div className="w-9" />
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop: always visible, Mobile: slide-in menu */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r bg-card transition-transform duration-200 md:static md:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="sticky top-0 flex h-full flex-col">
          <div className="p-4">
            {/* Desktop title with icon */}
            <div className="mb-6 hidden md:flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <LayoutDashboard className="h-4 w-4 text-primary" />
              </div>
              <h1 className="text-lg font-semibold">Admin</h1>
            </div>
            {/* Mobile: add top padding for header */}
            <div className="h-14 md:hidden" />
            <nav className="space-y-1">
              {sections.map((section) => {
                const Icon = section.icon
                const isActive = activeSection === section.key
                return (
                  <button
                    key={section.key}
                    onClick={() => handleSectionChange(section.key)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all md:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", isActive && "text-primary")} />
                    {section.label}
                  </button>
                )
              })}
            </nav>
          </div>
          {/* Back to app link at bottom */}
          <div className="mt-auto hidden md:block border-t p-4">
            <button
              onClick={() => router.push("/")}
              className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to app
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-6xl space-y-6 p-4 md:space-y-8 md:p-8">
          {/* Overview Section */}
          {activeSection === "overview" && (
            <>
              {/* Global Time Range Selector */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold md:text-xl">Overview</h2>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {/* Include admins toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={includeAdmins}
                    onClick={() => setIncludeAdmins((v) => !v)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all sm:text-sm",
                      includeAdmins
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                        includeAdmins ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        className={cn(
                          "h-3 w-3 rounded-full bg-background transition-transform",
                          includeAdmins ? "translate-x-3" : "translate-x-0"
                        )}
                      />
                    </span>
                    Include admins
                  </button>
                  {/* Metric selector */}
                  <div className="flex gap-1 rounded-lg bg-muted p-1">
                    {METRIC_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        onClick={() => setMetric(option.key)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
                          metric === option.key
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {/* Credential pool selector. Disabled under the Messages
                      metric, which is sourced from ActivityLog and carries no
                      pool dimension — see POOL_DISABLED_HINT. */}
                  <div
                    className={cn(
                      "flex gap-1 rounded-lg bg-muted p-1",
                      poolFilterDisabled && "opacity-50"
                    )}
                    title={poolFilterDisabled ? POOL_DISABLED_HINT : undefined}
                  >
                    {POOL_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        onClick={() => setPool(option.key)}
                        disabled={poolFilterDisabled}
                        title={poolFilterDisabled ? POOL_DISABLED_HINT : option.hint}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
                          poolFilterDisabled && "cursor-not-allowed",
                          !poolFilterDisabled && pool === option.key
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {/* Time range buttons */}
                  <div className="flex gap-1 rounded-lg bg-muted p-1">
                    {(["24h", "7d", "30d", "all"] as const).map((range) => (
                      <button
                        key={range}
                        onClick={() => setGlobalTimeRange(range)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
                          globalTimeRange === range
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {range === "all" ? "All" : range}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Charts Grid */}
              <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
                {/* Metric over time */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
                      <MessageSquare className="h-4 w-4 text-purple-500" />
                    </div>
                    <h3 className="font-medium">
                      {metric === "messages"
                        ? `${isHourly ? "Hourly" : "Daily"} Messages & Conversations`
                        : `${metricName} over time`}
                    </h3>
                  </div>
                  <DailyMessagesChatsChart data={series} metric={metric} isHourly={isHourly} />
                </div>

                {/* Metric by Agent/Model */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                  <MessagesByModelChart
                    agentData={byAgent}
                    modelData={byModel}
                    metric={metric}
                    metricName={metricName}
                    isHourly={isHourly}
                  />
                </div>

                {/* Weekly Active Users */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                      <Users className="h-4 w-4 text-green-500" />
                    </div>
                    <h3 className="font-medium">Weekly Active Users</h3>
                  </div>
                  <UserGrowthChart data={weeklyActiveUsers} />
                </div>

                {/* Top Active Users */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                      <Trophy className="h-4 w-4 text-amber-500" />
                    </div>
                    <h3 className="font-medium">Top Users by {metricName}</h3>
                  </div>
                  <TopUsersTable
                    data={topUsers}
                    metric={metric}
                    isLoading={statsQuery.isFetching}
                  />
                </div>

                {/* Peak Hours */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm lg:col-span-2">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/10">
                      <Clock className="h-4 w-4 text-pink-500" />
                    </div>
                    <h3 className="font-medium">
                      {metric === "messages" ? "Peak Activity Hours" : `${metricName} by Hour`}
                    </h3>
                  </div>
                  <HourlyActivityChart data={hourly} metric={metric} />
                </div>
              </section>

              {/* ── Shared-pool usage & tier limits ─────────────────────────
                  Scoped to one provider at a time: budgets are denominated in
                  different units per provider (tokens / USD / messages), so they
                  can't share an axis. Always shared-pool — a tier limit exists to
                  protect our own credentials, so simulating one against BYOK
                  usage would be meaningless. */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div>
                  <h2 className="text-lg font-semibold md:text-xl">Shared pool &amp; limits</h2>
                  <p className="text-xs text-muted-foreground">
                    Usage on our credentials only
                    {globalTimeRange === "all" && ", last 30 days"}
                  </p>
                </div>
                <div className="flex gap-1 rounded-lg bg-muted p-1">
                  {USAGE_PROVIDERS.map((option) => (
                    <button
                      key={option.key}
                      onClick={() => setUsageProvider(option.key)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
                        usageProvider === option.key
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
                {/* Per-user distribution */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10">
                      <BarChart3 className="h-4 w-4 text-indigo-500" />
                    </div>
                    <h3 className="font-medium">Usage distribution per user-day</h3>
                  </div>
                  {usageQuery.isLoading ? (
                    <div className="h-[250px] animate-pulse rounded bg-muted/50" />
                  ) : (
                    <UsageDistributionChart
                      values={usageSample}
                      unit={usageUnit}
                      stats={usageStats}
                      freeLimit={usage?.currentLimits.free ?? null}
                    />
                  )}
                </div>

                {/* Shared vs own key */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10">
                      <Wallet className="h-4 w-4 text-teal-500" />
                    </div>
                    <h3 className="font-medium">Shared pool vs own key</h3>
                  </div>
                  {usageQuery.isLoading ? (
                    <div className="h-[250px] animate-pulse rounded bg-muted/50" />
                  ) : (
                    <PoolSplitChart data={usage?.poolSplit ?? []} unit={usageUnit} />
                  )}
                </div>

                {/* Per-key breakdown — OpenCode is the only multi-key pool */}
                {usageProvider === "opencode" && (
                  <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
                        <KeyRound className="h-4 w-4 text-orange-500" />
                      </div>
                      <h3 className="font-medium">OpenCode usage by key</h3>
                    </div>
                    {usageQuery.isLoading ? (
                      <div className="h-[250px] animate-pulse rounded bg-muted/50" />
                    ) : (
                      <UsageByKeyChart
                        data={usage?.byKey ?? []}
                        keyIds={usage?.keyIds ?? []}
                        unit={usageUnit}
                      />
                    )}
                  </div>
                )}

                {/* Limit simulator */}
                <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10">
                      <SlidersHorizontal className="h-4 w-4 text-rose-500" />
                    </div>
                    <h3 className="font-medium">Tier limit simulator</h3>
                  </div>
                  {usageQuery.isLoading ? (
                    <div className="h-[250px] animate-pulse rounded bg-muted/50" />
                  ) : (
                    <LimitSimulator
                      key={`${usageProvider}-${usage?.currentLimits.free ?? "none"}`}
                      perUser={perUser}
                      unit={usageUnit}
                      freeLimit={usage?.currentLimits.free ?? null}
                      proMultiplier={usage?.proMultiplier ?? 2}
                    />
                  )}
                </div>
              </section>
            </>
          )}

          {/* Users Section */}
          {activeSection === "users" && (
            <section>
              <h2 className="mb-4 text-lg font-semibold md:text-xl">User Management</h2>
              <UserTable
                users={usersQuery.data?.users ?? []}
                pagination={
                  usersQuery.data?.pagination ?? {
                    page: 1,
                    limit: 20,
                    total: 0,
                    totalPages: 0,
                  }
                }
                isLoading={usersQuery.isLoading}
                searchQuery={usersSearch}
                sortField={sortField}
                sortOrder={sortOrder}
                onSearchChange={(search) => {
                  setUsersSearch(search)
                  setUsersPage(1)
                }}
                onPageChange={setUsersPage}
                onSortChange={handleSortChange}
                onToggleAdmin={(userId, isAdmin) => {
                  updateUserMutation.mutate({ userId, isAdmin })
                }}
                onPlanChange={(userId, plan) => {
                  updateUserMutation.mutate({ userId, plan })
                }}
                isUpdating={updateUserMutation.isPending ? updateUserMutation.variables?.userId : null}
                currentUserId={session?.user?.id}
              />
            </section>
          )}

          {/* Activity Section */}
          {activeSection === "activity" && (
            <section>
              <h2 className="mb-4 text-lg font-semibold md:text-xl">Recent Activity</h2>
              <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
                <ActivityFeed
                  activities={activityQuery.data?.activities ?? []}
                  filters={activityQuery.data?.filters}
                  filterState={activityFilters}
                  onFilterChange={(filters) => {
                    setActivityFilters(filters)
                    setActivityPage(1)
                  }}
                  isLoading={activityQuery.isLoading}
                  hasMore={
                    activityQuery.data
                      ? activityQuery.data.pagination.page <
                        activityQuery.data.pagination.totalPages
                      : false
                  }
                  onLoadMore={() => setActivityPage((p) => p + 1)}
                />
              </div>
            </section>
          )}

          {/* Credentials Section */}
          {activeSection === "credentials" && <ClaudeCredentials />}
        </div>
      </main>
    </div>
  )
}
