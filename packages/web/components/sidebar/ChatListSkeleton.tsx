import { cn } from "@/lib/utils"

/**
 * Placeholder rows shown in the chat list while chats are still loading.
 * The mobile and desktop sidebars use slightly different spacing and bar
 * widths, but otherwise render the same pulsing skeleton markup.
 */
export function ChatListSkeleton({
  widths,
  containerClassName,
  rowClassName,
}: {
  widths: number[]
  containerClassName: string
  rowClassName: string
}) {
  return (
    <div className={cn(containerClassName, "animate-pulse")}>
      {widths.map((width, i) => (
        <div key={i} className={rowClassName}>
          <div className="h-5 flex-1 rounded bg-muted" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  )
}
