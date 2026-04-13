import "./globals.css"

export const metadata = {
  title: "Hari Om ERP",
  description: "Recovered local ERP runtime",
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
