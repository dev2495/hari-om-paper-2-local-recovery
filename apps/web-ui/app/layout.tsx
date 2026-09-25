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
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("hariom_theme_v1");document.documentElement.dataset.theme=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.density=localStorage.getItem("hariom_density_v1")==="compact"?"compact":"comfortable";var m=matchMedia("(prefers-color-scheme: dark)");m.addEventListener&&m.addEventListener("change",function(e){var s=localStorage.getItem("hariom_theme_v1");if(s!=="light"&&s!=="dark")document.documentElement.dataset.theme=e.matches?"dark":"light"})}catch(e){}})()` }} /></head>
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
