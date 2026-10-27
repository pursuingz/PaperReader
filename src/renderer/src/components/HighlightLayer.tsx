import { highlightColorHex } from '../../../shared/colors'
import type { Highlight } from '../../../shared/types'
export default function HighlightLayer({ highlights, page }: { highlights: Highlight[]; page: number }) {
  return <div className="highlight-layer" aria-hidden="true">{highlights.filter(item => item.page === page).flatMap(item => item.rects.map((rect, index) => <span className="pdf-highlight" data-highlight-id={item.id} key={`${item.id}-${index}`} style={{ background: highlightColorHex(item.color), left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}/>))}</div>
}
