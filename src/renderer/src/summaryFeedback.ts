export function summaryFailureMessage(error: unknown, hasSavedSummary: boolean): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const detail = raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim() || 'Summary generation failed. Please retry.'
  const preservationNotice = 'Your saved summary is unchanged.'
  return hasSavedSummary && !detail.includes(preservationNotice) ? `${detail} ${preservationNotice}` : detail
}
