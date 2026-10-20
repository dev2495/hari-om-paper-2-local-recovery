import type { Metadata } from "next"

import "./globals.css"
import "./tubeos.css"
import "./dark-theme-colours.css"
import { QueryProvider } from "@/components/providers/query-provider"
import { AuthProvider } from "@/context/AuthContext"
import { AppProvider } from "@/context/AppContext"
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot"

export const metadata: Metadata = {
  title: "Hari Om ERP",
  description: "Paper tube manufacturing ERP",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Light or dark: follows the device by default; the top-bar button switches it (lib/theme.ts).
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head><meta name="color-scheme" content="light dark" /><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body>
        <AuthProvider>
          <AppProvider>
            <QueryProvider>{children}</QueryProvider>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
