import type { Metadata } from "next"

import "./globals.css"
import { QueryProvider } from "@/components/providers/query-provider"
import { AuthProvider } from "@/context/AuthContext"
import { AppProvider } from "@/context/AppContext"

export const metadata: Metadata = {
  title: "Hari Om ERP",
  description: "Paper tube manufacturing ERP",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
