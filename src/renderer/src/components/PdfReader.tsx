import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { Highlight, NormalizedRect, PdfCaptureInput, PdfCaptureAction } from '../../../shared/types'
import { highlightSearchText } from '../pdfSearch'
import HighlightLayer from './HighlightLayer'
import PdfInkLayer, { type PdfInkLayerProps } from './PdfInkLayer'
import PdfInteractionLayer from './PdfInteractionLayer'
import { capturePdfRaster, PdfRenderLifecycle, type PdfInteractionMode } from '../pdfInteraction'
import { PdfFrameBuffer, type PdfFrame, type PdfFramePart } from '../pdfFrameBuffer'

// AnnotationLayer appends annotation-<name>.svg to Vite's publicDir resources.
const annotationImageResourcesPath = './'

interface Props {
  file: { data: Uint8Array } | undefined; page: number; width: number; highlights: Highlight[]
  ink?: Omit<PdfInkLayerProps, 'page'>
  searchQuery?: string
  interactionMode?: PdfInteractionMode
  scrollElement?: HTMLElement | null
  onCapture?(capture: PdfCaptureInput,action?:PdfCaptureAction): Promise<void>
  onRendered?(page: number): void
  onLoaded(pageCount: number): void; onText(page: number, text: string): void; onError(error: Error): void
}

interface FramePageProps {
  frame: PdfFrame
  searchQuery: string
  onPart(frame: PdfFrame, part: PdfFramePart, canvas?: HTMLCanvasElement | null): void
  onText(frame: PdfFrame, text: string): void
  onFailure(frame: PdfFrame, error: Error): void
  children: ReactNode
}

/** Stable callbacks keep unrelated composer/camera renders out of PDF.js work. */
function FramePage({ frame, searchQuery, onPart, onText, onFailure, children }: FramePageProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const textRenderer = useCallback(({ str }: { str: string }) => highlightSearchText(str, searchQuery), [searchQuery])
  const rendered = useCallback((value: pdfjs.PDFPageProxy) => {
    if (value.pageNumber === frame.page) onPart(frame, 'canvas', canvas.current)
  }, [frame, onPart])
  const textRendered = useCallback(() => onPart(frame, 'text'), [frame, onPart])
  const annotationsRendered = useCallback(() => onPart(frame, 'annotations'), [frame, onPart])
  const textLoaded = useCallback((content: { items: unknown[] }) => {
    onText(frame, content.items.map(item => item && typeof item === 'object' && 'str' in item ? String(item.str) : '').join(' '))
  }, [frame, onText])
  const failed = useCallback((error: unknown) => onFailure(frame, error instanceof Error ? error : new Error(String(error))), [frame, onFailure])
  return <Page canvasRef={canvas} pageNumber={frame.page} width={frame.width} devicePixelRatio={frame.pixelRatio}
    renderTextLayer renderAnnotationLayer customTextRenderer={searchQuery ? textRenderer : undefined}
    onRenderSuccess={rendered} onRenderTextLayerSuccess={textRendered} onRenderAnnotationLayerSuccess={annotationsRendered} onGetTextSuccess={textLoaded}
    onLoadError={failed} onRenderError={failed} onGetTextError={failed} onRenderTextLayerError={failed} onGetAnnotationsError={failed} onRenderAnnotationLayerError={failed}>
    {children}
  </Page>
}

/** The PDF proxy belongs to this mounted Reader, never to the Summary view. */
export default function PdfReader({ file, page, width, highlights, ink, searchQuery = '', interactionMode = 'read', scrollElement, onCapture, onRendered, onLoaded, onText, onError }: Props) {
  const [loaded, setLoaded] = useState<{ file: Props['file']; value: pdfjs.PDFDocumentProxy } | null>(null)
  const document = loaded && loaded.file === file ? loaded.value : null
  const currentFile = useRef(file); currentFile.current = file
  const mounted = useRef(true)
  const raster = useRef<{ frame: number; canvas: HTMLCanvasElement } | null>(null)
  const lifecycle = useRef(new PdfRenderLifecycle())
  const buffer = useRef(new PdfFrameBuffer())
  const visiblePage = document ? Math.min(page, document.numPages) : page
  const pixelRatio = window.devicePixelRatio || 1
  const frame = lifecycle.current.update(file, visiblePage, width, interactionMode, pixelRatio)
  const request = buffer.current.request({ id: frame, file, page: visiblePage, width, pixelRatio })
  const [readyFrame, setReadyFrame] = useState(0)
  const [failure, setFailure] = useState<{ frame: number; error: Error } | null>(null)
  const notified = useRef(0)
  const callbacks = useRef({ onLoaded, onText, onError, onCapture, onRendered })
  callbacks.current = { onLoaded, onText, onError, onCapture, onRendered }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifecycle.current.cancelCapture() } }, [])
  const partRendered = useCallback((value: PdfFrame, part: PdfFramePart, canvas?: HTMLCanvasElement | null) => {
    if (!mounted.current || currentFile.current !== value.file || buffer.current.frames.at(-1)?.id !== value.id) return
    if (part === 'canvas') {
      if (!canvas?.width || !canvas.height) return
      raster.current = { frame: value.id, canvas }
    }
    if (buffer.current.complete(value.id, part) && lifecycle.current.rendered(value.id)) setReadyFrame(value.id)
  }, [])
  const pageTextLoaded = useCallback((value: PdfFrame, text: string) => {
    if (mounted.current && currentFile.current === value.file && buffer.current.frames.at(-1)?.id === value.id) callbacks.current.onText(value.page, text)
  }, [])
  const frameFailed = useCallback((value: PdfFrame, error: Error) => {
    if (!mounted.current || currentFile.current !== value.file || !buffer.current.fail(value.id)) return
    lifecycle.current.failed(value.id); setReadyFrame(0); setFailure({ frame: value.id, error }); callbacks.current.onError(error)
  }, [])
  useLayoutEffect(() => {
    if (readyFrame !== frame || notified.current === frame || !buffer.current.interactive(frame)) return
    notified.current = frame
    callbacks.current.onRendered?.(visiblePage)
  }, [readyFrame, frame, visiblePage])

  async function capture(rect: NormalizedRect,action:PdfCaptureAction='canvas'): Promise<boolean> {
    const ticket = lifecycle.current.beginCapture(frame), source = raster.current?.frame === frame ? raster.current.canvas : null, save = callbacks.current.onCapture
    if (!ticket || !source?.width || !source.height || !save || !buffer.current.interactive(frame)) throw new Error('Wait for this PDF page to finish rendering before capturing.')
    const current = () => mounted.current && lifecycle.current.current(ticket) && buffer.current.interactive(frame) && raster.current?.canvas === source && source.isConnected
    const bytes = await capturePdfRaster(source, rect, current)
    if (!bytes || !current()) return false
    await save({ page: visiblePage, rect: { ...rect }, bytes },action)
    return current()
  }
  const displayed = buffer.current.displayed
  const pending = !buffer.current.interactive(frame)
  return <Document file={file} imageResourcesPath={annotationImageResourcesPath} onLoadSuccess={value => {
    if (!mounted.current || currentFile.current !== file) return
    setLoaded({ file, value }); callbacks.current.onLoaded(value.numPages)
  }} onLoadError={error => { if (mounted.current && currentFile.current === file) callbacks.current.onError(error) }} loading={<div className="pane-empty">Rendering PDF…</div>}>
    <div data-pdf-render-state={pending ? 'pending' : 'ready'} style={{ position: 'relative', width: displayed?.width ?? request.width }}>
      {buffer.current.frames.map(value => {
        const interactive = buffer.current.interactive(value.id)
        const hidden = Boolean(displayed && displayed.id !== value.id)
        return <div key={value.id} data-pdf-frame={value.id} data-pdf-frame-state={interactive ? 'active' : hidden ? 'pending' : 'preview'} inert={!interactive} aria-hidden={!interactive}
          style={hidden ? { position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' } : { width: value.width, pointerEvents: interactive ? undefined : 'none' }}>
          <FramePage frame={value} searchQuery={searchQuery} onPart={partRendered} onText={pageTextLoaded} onFailure={frameFailed}>
            <HighlightLayer highlights={highlights} page={value.page}/>
            {ink && <PdfInkLayer {...ink} drawing={interactive && interactionMode === 'read' && ink.drawing} page={value.page}/>}
            {interactive && interactionMode !== 'read' && <PdfInteractionLayer key={String(value.id) + ':' + interactionMode} mode={interactionMode} page={value.page} ready={readyFrame === value.id} scrollElement={scrollElement} onConfirm={capture} onCancel={() => lifecycle.current.cancelCapture()}/>}
          </FramePage>
        </div>
      })}
      {failure?.frame === frame ? <div role="alert" style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 1, padding: 12, background: '#fff3f0', color: '#8f4438' }}>Page {visiblePage} could not finish rendering: {failure.error.message}</div>
        : pending && displayed && <div role="status" style={{ position: 'absolute', top: 12, left: 12, padding: '7px 10px', borderRadius: 6, background: '#f4f6f8', color: '#536074', fontSize: 12, pointerEvents: 'none' }}>Rendering page {visiblePage}…</div>}
    </div>
  </Document>
}



