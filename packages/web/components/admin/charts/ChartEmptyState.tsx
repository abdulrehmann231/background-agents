/**
 * Placeholder shown in place of a chart when there is no data to plot.
 * Matches the fixed 250px chart height so the dashboard layout doesn't shift.
 */
export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
      {message}
    </div>
  )
}
