"use client"

import { useState } from "react"
import type { InputHTMLAttributes } from "react"
import { Eye, EyeOff } from "lucide-react"

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return <div className="relative">
    <input {...props} aria-label={props["aria-label"] || "Password"} type={visible ? "text" : "password"} className={`${props.className || "h-12 w-full rounded-xl border border-border px-4"} pr-14`} />
    <button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}
      onClick={() => setVisible(!visible)} className="absolute inset-y-0 right-1 flex w-11 items-center justify-center rounded-xl text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
      {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
    </button>
  </div>
}
