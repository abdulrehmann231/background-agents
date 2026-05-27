"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { chartTooltipProps, lineTooltipCursor } from "./chartTooltip"
import { formatAxisDate, formatTooltipDate, formatHour } from "./chartFormatters"

interface MessagesChatsData {
  time: string
  messages: number
  chats: number
}

interface DailyMessagesChatsChartProps {
  data: MessagesChatsData[]
  isHourly?: boolean
}

export function DailyMessagesChatsChart({ data, isHourly = false }: DailyMessagesChatsChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No data available
      </div>
    )
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) =>
              isHourly ? formatHour(Number(value)) : formatAxisDate(value)
            }
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            interval={isHourly ? 3 : "preserveStartEnd"}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            width={45}
          />
          <Tooltip
            {...chartTooltipProps}
            cursor={lineTooltipCursor}
            labelFormatter={(label) =>
              isHourly ? formatHour(Number(label)) : formatTooltipDate(label)
            }
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
          />
          <Line
            type="monotone"
            dataKey="messages"
            name="Messages"
            stroke="hsl(262, 83%, 58%)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="chats"
            name="Conversations"
            stroke="hsl(152, 60%, 50%)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
