import type { Metadata } from "next"

import "./globals.css"
import "./tubeos.css"
import { QueryProvider } from "@/components/providers/query-provider"
import { AuthProvider } from "@/context/AuthContext"
import { AppProvider } from "@/context/AppContext"

export const metadata: Metadata = {
  title: "Hari Om ERP",
  description: "Paper tube manufacturing ERP",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The ERP is light-only: a dark Windows/macOS setting used to flip the text to white while
    // many panels stay light, leaving white-on-white labels. Never follow the OS theme.
    <html lang="en" data-theme="light" style={{ colorScheme: "light" }} suppressHydrationWarning>
      <head><meta name="color-scheme" content="only light" /><script dangerouslySetInnerHTML={{ __html: `(function(){try{document.documentElement.dataset.theme="light";localStorage.removeItem("hariom_theme_v1");document.documentElement.dataset.density=localStorage.getItem("hariom_density_v1")==="compact"?"compact":"comfortable"}catch(e){}})()` }} /></head>
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
