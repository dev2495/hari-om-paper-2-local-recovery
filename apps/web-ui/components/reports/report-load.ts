// What a report part shows when its API call fails, so an error never reads as a real zero.
export function reportLoadNote(error: unknown): string | null {
  if (!error) return null
  const status = Number((error as any)?.response?.status || 0)
  if (status === 403) return "Not available for your role."
  return "Could not load these numbers. Refresh the page to try again."
}
