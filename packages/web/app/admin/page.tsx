"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Users,
  Activity,
  LayoutDashboard,
  KeyRound,
  Menu,
  X,
  ArrowLeft,
  Trophy,
} from "lucide-react"
import { ActivityFeed } from "@/components/admin/ActivityFeed"
import { ClaudeCredentials } from "@/components/admin/ClaudeCredentials"
import { UserTable, type SortField, type SortOrder } from "@/components/admin/UserTable"
import { OverviewSection } from "@/components/admin/OverviewSection"
import { LeaderboardSection } from "@/components/admin/LeaderboardSection"
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
  type UsageMetric,
} from "@/lib/query/hooks"
import { type StatsMetric } from "@/components/admin/charts/chartFormatters"
import { COST_PROVIDERS, BILLED_PROVIDERS } from "@/components/admin/constants"
import { cn } from "@/lib/utils"

type SectionKey = "overview" | "leaderboard" | "users" | "activity" | "credentials"

const sections: { key: SectionKey; label: string; icon: typeof Users }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "leaderboard", label: "Leaderboard", icon: Trophy },
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

  // Global state shared across sections
  const [globalTimeRange, setGlobalTimeRange] = useState<StatsTimeRange>("7d")
  const [includeAdmins, setIncludeAdmins] = useState(false)
  const [metric, setMetric] = useState<StatsMetric>("tokens")
  const [pool, setPool] = useState<StatsPool>("shared")
  const poolFilterDisabled = metric === "messages"
  const effectivePool: StatsPool = poolFilterDisabled ? "all" : pool

  // Usage block state
  const [usageProvider, setUsageProvider] = useState<UsageProvider>("claude")
  const [usageMetric, setUsageMetric] = useState<UsageMetric>("cost")
  const costSupported = COST_PROVIDERS.has(usageProvider)
  const effectiveUsageMetric: UsageMetric = costSupported ? usageMetric : "tokens"
  const costIsNotional =
    effectiveUsageMetric === "cost" && !BILLED_PROVIDERS.has(usageProvider)
  const usageRange: UsageRange = globalTimeRange === "all" ? "30d" : globalTimeRange

  // Queries
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
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortOrder("desc")
    }
    setUsersPage(1)
  }

  // Redirect if not authenticated or forbidden
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
    }
  }, [status, router])

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

  if (status === "unauthenticated") {
    return null
  }

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
        <div className="w-9" />
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r bg-card transition-transform duration-200 md:static md:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="sticky top-0 flex h-full flex-col">
          <div className="p-4">
            <div className="mb-6 hidden md:flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <LayoutDashboard className="h-4 w-4 text-primary" />
              </div>
              <h1 className="text-lg font-semibold">Admin</h1>
            </div>
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
          {activeSection === "overview" && (
            <OverviewSection
              globalTimeRange={globalTimeRange}
              onTimeRangeChange={setGlobalTimeRange}
              includeAdmins={includeAdmins}
              onIncludeAdminsChange={setIncludeAdmins}
              metric={metric}
              onMetricChange={setMetric}
              pool={pool}
              onPoolChange={setPool}
              poolFilterDisabled={poolFilterDisabled}
              usageProvider={usageProvider}
              onUsageProviderChange={setUsageProvider}
              usageMetric={usageMetric}
              onUsageMetricChange={setUsageMetric}
              costSupported={costSupported}
              effectiveUsageMetric={effectiveUsageMetric}
              costIsNotional={costIsNotional}
              usageRange={usageRange}
              statsQuery={statsQuery}
              usageQuery={usageQuery}
            />
          )}

          {activeSection === "leaderboard" && (
            <LeaderboardSection
              globalTimeRange={globalTimeRange}
              onTimeRangeChange={setGlobalTimeRange}
              includeAdmins={includeAdmins}
              onIncludeAdminsChange={setIncludeAdmins}
              metric={metric}
              onMetricChange={setMetric}
              pool={pool}
              onPoolChange={setPool}
              poolFilterDisabled={poolFilterDisabled}
              usageProvider={usageProvider}
              onUsageProviderChange={setUsageProvider}
              usageMetric={usageMetric}
              onUsageMetricChange={setUsageMetric}
              costSupported={costSupported}
              effectiveUsageMetric={effectiveUsageMetric}
              costIsNotional={costIsNotional}
              usageRange={usageRange}
              statsQuery={statsQuery}
              usageQuery={usageQuery}
            />
          )}

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

          {activeSection === "credentials" && <ClaudeCredentials />}
        </div>
      </main>
    </div>
  )
}
