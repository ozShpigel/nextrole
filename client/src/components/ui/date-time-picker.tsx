"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

const MINUTE_STEP = 5

function pad(n: number) {
  return String(n).padStart(2, "0")
}

// value/onChange keep the same "YYYY-MM-DDTHH:mm" shape the native
// <input type="datetime-local"> this replaces used to produce, so callers
// (new Date(value)) don't need to change.
function parseValue(value: string): { date: Date | undefined; hour: string; minute: string } {
  if (!value) return { date: undefined, hour: "", minute: "" }
  const d = new Date(value)
  if (isNaN(d.getTime())) return { date: undefined, hour: "", minute: "" }
  return { date: d, hour: pad(d.getHours()), minute: pad(d.getMinutes()) }
}

function toValue(date: Date, hour: string, minute: string): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${hour}:${minute}`
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
function minuteOptions(current: string): string[] {
  const opts = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => pad(i * MINUTE_STEP))
  if (current && !opts.includes(current)) return [...opts, current].sort()
  return opts
}

interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

// Calendar renders inline rather than behind a Popover trigger: nesting a
// Radix Popover inside a Radix Dialog breaks here because @radix-ui/react-popover
// pulls in its own copy of react-dismissable-layer, a different module
// instance from the one react-dialog uses — their layer stacks aren't
// actually shared, so the Dialog's focus trap fights the Popover's and
// swallows clicks on the calendar days. Inline avoids the nested-portal
// interaction entirely.
export function DateTimePicker({ value, onChange, className }: DateTimePickerProps) {
  const { date, hour, minute } = parseValue(value)

  function selectDate(next: Date | undefined) {
    if (!next) return
    onChange(toValue(next, hour || "09", minute || "00"))
  }

  function selectHour(next: string) {
    onChange(toValue(date ?? new Date(), next, minute || "00"))
  }

  function selectMinute(next: string) {
    onChange(toValue(date ?? new Date(), hour || "09", next))
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="rounded-md border w-fit">
        <Calendar mode="single" selected={date} onSelect={selectDate} />
      </div>

      <div className="flex gap-2">
        <Select value={hour} onValueChange={selectHour} disabled={!date}>
          <SelectTrigger className="w-[4.5rem]">
            <SelectValue placeholder="HH" />
          </SelectTrigger>
          <SelectContent>
            {HOURS.map((h) => (
              <SelectItem key={h} value={h}>{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={minute} onValueChange={selectMinute} disabled={!date}>
          <SelectTrigger className="w-[4.5rem]">
            <SelectValue placeholder="MM" />
          </SelectTrigger>
          <SelectContent>
            {minuteOptions(minute).map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
