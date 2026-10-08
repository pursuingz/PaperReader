import { useEffect, useMemo, useRef, useState } from 'react'
import { pdfjs } from 'react-pdf'
import type { DesktopAPI } from '../../shared/types'
import { LocalPdfNavigation, normalizeOutline, type NavigationOutlineNode } from './pdfNavigation'

interface NavigationState {
  paperId: string
  revision: number
  document: pdfjs.PDFDocumentProxy | null
  outline: NavigationOutlineNode[]
  loading: boolean
  outlineLoading: boolean
  outlineLimited: boolean
  error: string
  outlineError: string
}
const pending = (paperId: string, revision: number): NavigationState => ({ paperId, revision, document: null, outline: [], loading: true, outlineLoading: true, outlineLimited: false, error: '', outlineError: '' })
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The PDF could not be read.'

/** Navigation owns a separate loading task; no mounted Reader proxy enters here. */
export default function usePdfNavigation(api: Pick<DesktopAPI, 'readPaper'>, paperId: string) {
  const session = useMemo(() => new LocalPdfNavigation(id => api.readPaper(id), bytes => pdfjs.getDocument({ data: bytes })), [api])
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<NavigationState>(() => pending(paperId, revision))
  const identity = useRef({ paperId, revision, session })
  identity.current = { paperId, revision, session }
  useEffect(() => {
    let alive = true
    const current = () => alive && identity.current.paperId === paperId && identity.current.revision === revision && identity.current.session === session
    setState(pending(paperId, revision))
    void session.open(paperId).then(async document => {
      if (!document || !current() || !session.isCurrent(document)) return
      setState({ ...pending(paperId, revision), loading: false, document })
      try {
        const outline = normalizeOutline(await document.getOutline())
        if (current() && session.isCurrent(document)) setState(value => ({ ...value, outline: outline.items, outlineLimited: outline.limited, outlineLoading: false }))
      } catch (error) {
        if (current() && session.isCurrent(document)) setState(value => ({ ...value, outlineLoading: false, outlineError: `The PDF outline could not be read: ${errorText(error)}` }))
      }
    }).catch(error => {
      if (current()) setState({ ...pending(paperId, revision), loading: false, outlineLoading: false, error: errorText(error) })
    })
    return () => { alive = false; void session.cancel() }
  }, [session, paperId, revision])
  const visible = state.paperId === paperId && state.revision === revision ? state : pending(paperId, revision)
  return {
    ...visible,
    retry: () => setRevision(value => value + 1),
    resolve: (destination: unknown) => session.resolve(destination),
    isCurrent: (document: pdfjs.PDFDocumentProxy) => identity.current.paperId === paperId && identity.current.revision === revision && identity.current.session === session && session.isCurrent(document)
  }
}
