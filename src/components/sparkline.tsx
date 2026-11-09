import { useId } from 'react'
import { cn } from '@/lib/cn'
import type { Sample } from '@/lib/types'

const width = 240
const height = 64
const padding = 4

type Point = { x: number; y: number }

// An outage is a gap, not a value: a segment breaks at any sample that is
// offline or carries no RSSI, so the curve never draws a line through a
// moment the device was unreachable.
// A fixed dBm window rather than a per-window autoscale: a flat line then
// means a steady signal, not a squashed one, and a weak link visually sits
// where it belongs. Values outside the window are clamped to the edge.
const floor = -90
const ceiling = -30

const yOf = (rssi: number): number => {
  const clamped = Math.min(ceiling, Math.max(floor, rssi))
  return padding + (1 - (clamped - floor) / (ceiling - floor)) * (height - padding * 2)
}

const segmentsOf = (samples: Sample[]): Point[][] => {
  const segments: Point[][] = []
  let current: Point[] = []
  samples.forEach((sample, index) => {
    if (!sample.online || sample.rssi === null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    const x = samples.length === 1 ? width / 2 : (index / (samples.length - 1)) * width
    current.push({ x, y: yOf(sample.rssi) })
  })
  if (current.length > 0) segments.push(current)
  return segments
}

const pathOf = (points: Point[]): string =>
  points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')

export const Sparkline = ({
  samples,
  className,
}: Readonly<{ samples: Sample[]; className?: string }>) => {
  const gradientId = useId()
  const segments = segmentsOf(samples)
  const last = segments.at(-1)?.at(-1)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-16 w-full text-accent', className) as string}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        x2={width}
        y1={yOf(-70)}
        y2={yOf(-70)}
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      {segments.map(segment => (
        <g key={`${segment[0].x}:${segment.at(-1)?.x ?? 0}`}>
          <path
            d={`${pathOf(segment)} L${segment.at(-1)?.x ?? 0} ${height} L${segment[0].x} ${height} Z`}
            fill={`url(#${gradientId})`}
          />
          <path
            d={pathOf(segment)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
      {last !== undefined && (
        <circle
          cx={last.x}
          cy={last.y}
          r="2.5"
          fill="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}
