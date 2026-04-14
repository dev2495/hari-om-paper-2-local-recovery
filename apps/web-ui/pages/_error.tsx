import type { NextPageContext } from "next"

type ErrorPageProps = {
  statusCode?: number
}

function ErrorPage({ statusCode }: ErrorPageProps) {
  const title =
    statusCode && statusCode >= 500
      ? "A server error occurred while loading this page."
      : statusCode
      ? `Request failed with status ${statusCode}.`
      : "A client-side error occurred while loading this page."

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6f1e7_0%,#ebe4d6_100%)] px-6 py-12 text-slate-900">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-white/70 bg-white/90 p-10 shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">TubeOS Runtime</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Something interrupted this screen.</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">{title}</p>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Status: {statusCode || "CLIENT_ERROR"}
        </div>
      </div>
    </main>
  )
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode || err?.statusCode || 500
  return { statusCode }
}

export default ErrorPage
