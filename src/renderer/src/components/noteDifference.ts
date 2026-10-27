export interface NoteDifferenceRow { kind: 'same' | 'removed' | 'added'; text: string; originalLine?: number; proposedLine?: number }
export interface NoteDifference { changed: boolean; rows: NoteDifferenceRow[]; truncated: boolean; removedLines: number; addedLines: number }

export function buildNoteDifference(original: string, proposal: string): NoteDifference {
  if (original === proposal) return { changed: false, rows: [], truncated: false, removedLines: 0, addedLines: 0 }
  const before = original.split('\n'), after = proposal.split('\n')
  const rows: NoteDifferenceRow[] = []
  const maxRows = 160, maxCharacters = 24_000, maxLine = 800
  let truncated = false, removedLines = 0, addedLines = 0, characters = 0
  function add(kind: NoteDifferenceRow['kind'], text: string, originalLine?: number, proposedLine?: number) {
    if (kind === 'removed') removedLines++; if (kind === 'added') addedLines++
    if (rows.length >= maxRows || characters >= maxCharacters) { truncated = true; return }
    const bounded = text.length > maxLine ? text.slice(0, maxLine) + ' …' : text
    if (bounded !== text) truncated = true
    if (characters + bounded.length > maxCharacters) { truncated = true; return }
    rows.push({ kind, text: bounded, originalLine, proposedLine }); characters += bounded.length
  }
  let left = 0, right = 0, prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  left = prefix; right = prefix
  if (prefix) add('same', before[prefix - 1], prefix, prefix)
  const beforeEnd = before.length - suffix, afterEnd = after.length - suffix
  while (left < beforeEnd || right < afterEnd) {
    if (left < beforeEnd && right < afterEnd && before[left] === after[right]) { add('same', before[left], left + 1, right + 1); left++; right++; continue }
    let deleteAhead = -1, addAhead = -1
    for (let step = 1; step <= 12; step++) {
      if (deleteAhead < 0 && left + step < beforeEnd && right < afterEnd && before[left + step] === after[right]) deleteAhead = step
      if (addAhead < 0 && right + step < afterEnd && left < beforeEnd && after[right + step] === before[left]) addAhead = step
    }
    if (deleteAhead > 0 && (addAhead < 0 || deleteAhead <= addAhead)) { for (let step = 0; step < deleteAhead; step++) { add('removed', before[left], left + 1); left++ }; continue }
    if (addAhead > 0) { for (let step = 0; step < addAhead; step++) { add('added', after[right], undefined, right + 1); right++ }; continue }
    if (left < beforeEnd) { add('removed', before[left], left + 1); left++ }
    if (right < afterEnd) { add('added', after[right], undefined, right + 1); right++ }
  }
  if (suffix) add('same', before[beforeEnd], beforeEnd + 1, afterEnd + 1)
  return { changed: true, rows, truncated, removedLines, addedLines }
}
