import { useCallback, useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { Highlight, NormalizedRect, PdfCaptureInput } from '../../../shared/types'
import { readReaderPage } from '../readingFeatures'
import { highlightSearchText } from '../pdfSearch'
import HighlightLayer from './HighlightLayer'
import PdfInkLayer, { type PdfInkLayerProps } from './PdfInkLayer'
import PdfInteractionLayer from './PdfInteractionLayer'
import { capturePdfRaster, PdfRenderLifecycle, type PdfInteractionMode } from '../pdfInteraction'

// Vite's publicDir copies PDF.js icons with their original names beside index.html.
// AnnotationLayer appends annotation-<name>.svg; hashed asset URLs cannot be used.
const annotationImageResourcesPath = './'

interface Props {
  file: { data: Uint8Array } | undefined; page: number; width: number; highlights: Highlight[]
  ink?: Omit<PdfInkLayerProps, 'page'>
  searchQuery?: string
  interactionMode?: PdfInteractionMode
  scrollElement?: HTMLElement | null
  onCapture?(capture: PdfCaptureInput): Promise<void>
  onRendered?(page: number): void
  onLoaded(pageCount: number): void; onText(page: number, text: string): void; onError(error: Error): void
}
/** The PDF proxy belongs to this mounted Reader, never to the Summary view. */
export default function PdfReader({ file, page, width, highlights, ink, searchQuery = '', interactionMode = 'read', scrollElement, onCapture, onRendered, onLoaded, onText, onError }: Props) {
  const [loaded, setLoaded] = useState<{ file: Props['file']; value: pdfjs.PDFDocumentProxy } | null>(null)
  const document = loaded && loaded.file === file ? loaded.value : null
  const currentFile = useRef(file)
  currentFile.current = file
  const mounted = useRef(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const lifecycle = useRef(new PdfRenderLifecycle())
  const visiblePage = document ? Math.min(page, document.numPages) : page
  const pixelRatio = window.devicePixelRatio || 1
  const frame = lifecycle.current.update(file, visiblePage, width, interactionMode, pixelRatio)
  const [readyFrame, setReadyFrame] = useState(0)
  const callbacks = useRef({ onLoaded, onText, onError, onCapture, onRendered })
  callbacks.current = { onLoaded, onText, onError, onCapture, onRendered }
  const renderSearchText = useCallback(({ str }: { str: string }) => highlightSearchText(str, searchQuery), [searchQuery])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifecycle.current.cancelCapture() } }, [])
  useEffect(() => {
    if (!document) return
    let alive = true
    const safePage = Math.min(page, document.numPages)
    const current = () => alive && mounted.current && currentFile.current === file
    void readReaderPage(document, safePage, current).then(text => {
      if (text !== null && current()) callbacks.current.onText(safePage, text)
    }).catch(error => { if (current()) callbacks.current.onError(error) })
    return () => { alive = false }
  }, [document, page, file])
  async function capture(rect: NormalizedRect): Promise<boolean> {
    const ticket = lifecycle.current.beginCapture(frame), source = canvas.current, save = callbacks.current.onCapture
    if (!ticket || !source?.width || !source.height || !save) throw new Error('Wait for this PDF page and Canvas to finish loading before capturing.')
    const current = () => mounted.current && lifecycle.current.current(ticket) && canvas.current === source && source.isConnected
    const bytes = await capturePdfRaster(source, rect, current)
    if (!bytes || !current()) return false
    await save({ page: visiblePage, rect: { ...rect }, bytes })
    return current()
  }
  return <Document file={file} imageResourcesPath={annotationImageResourcesPath} onLoadSuccess={value => {
    if (!mounted.current || currentFile.current !== file) return
    setLoaded({ file, value }); callbacks.current.onLoaded(value.numPages)
  }} onLoadError={error => { if (mounted.current && currentFile.current === file) callbacks.current.onError(error) }} loading={<div className="pane-empty">Rendering PDF…</div>}>
    <Page key={frame} canvasRef={canvas} pageNumber={visiblePage} width={width} devicePixelRatio={pixelRatio} renderTextLayer renderAnnotationLayer customTextRenderer={searchQuery ? renderSearchText : undefined}
      onRenderSuccess={value => {
        if (!mounted.current || currentFile.current !== file || value.pageNumber !== visiblePage || !canvas.current?.width || !canvas.current.height || !lifecycle.current.rendered(frame)) return
        setReadyFrame(frame); callbacks.current.onRendered?.(visiblePage)
      }}
      onRenderError={error => { if (mounted.current && currentFile.current === file && lifecycle.current.failed(frame)) { setReadyFrame(0); callbacks.current.onError(error) } }}>
      <HighlightLayer highlights={highlights} page={visiblePage}/>
      {ink && <PdfInkLayer {...ink} drawing={interactionMode === 'read' && ink.drawing} page={visiblePage}/>}
      {interactionMode !== 'read' && <PdfInteractionLayer key={`${frame}:${interactionMode}`} mode={interactionMode} page={visiblePage} ready={readyFrame === frame} scrollElement={scrollElement} onConfirm={capture} onCancel={() => lifecycle.current.cancelCapture()}/>}
    </Page>
  </Document>
}
