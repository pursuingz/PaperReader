import { useEffect, useMemo, useRef, useState } from 'react';
import { pdfjs } from 'react-pdf';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, Bot, Check, ChevronLeft, ChevronRight, Clock3, FileText, Library, Maximize2, MessageCircle, Minus, PanelRightClose, PanelRightOpen, Plus, Search, Settings, Sparkles, StickyNote, Tag, X, ZoomIn, ZoomOut, PenLine, Undo2, Redo2, Eraser, Download, Hand, ScanLine, Home, Minimize2 } from 'lucide-react';
import type { AIContextMode, AIRequest, AIRequestRecord, AppSettings, ChatMessage, DesktopCommand, DesktopMenuState, LibraryMetadata, NormalizedRect, Paper, PaperMetadata, PaperState, PdfCaptureInput, ReadingMarks } from '../../shared/types';
import { ORGANIZE_NOTES_DISPLAY_QUESTION } from '../../shared/aiPrompts';
import useGeneralChat from './useGeneralChat';
import GeneralChatPanel from './components/GeneralChatPanel';
import useAIRequestHistory from './useAIRequestHistory';
import RequestRetryButton from './components/RequestRetryButton';
import './generalChat.css';
import './components/requestRetryButton.css';
import { demoInitial, demoPaper, demoText } from './data/demo';
import DemoArticle from './components/DemoArticle';
import Welcome from './components/Welcome';
import SummaryView from './components/SummaryView';
import { acceptsAIResult, continueLatestTransition, deferredPaperStateSave, recoverPaperState } from './stateSafety';
import MarkdownContent from './components/MarkdownContent';
import './components/markdown.css';
import PaperSummaryView from './components/PaperSummaryView';
import ReadingNotes, { type NoteTab } from './components/ReadingNotes';
import PdfReader from './components/PdfReader';
import PdfNavigation from './components/PdfNavigation';
import CopyAnswer from './components/CopyAnswer';
import NoteSuggestionReview from './components/NoteSuggestionReview';
import { assertReviewPaper, canUndoAdoption, extractNoteProposal, prepareAdoption, undoAdoption, type NoteAdoptionUndo } from './noteAdoption';
import { NoteAdoptionSaveGate } from './noteAdoptionSave';
import SelectionToolbar from './components/SelectionToolbar';
import { isCurrentSelection, type SelectionAction, type SelectionSnapshot } from './selectionMenu';
import { applyPaperMetadata } from './libraryMetadata';
import { updateStreamPreview, type StreamPreview } from './streamPreview';
import useReadingMarks from './useReadingMarks';
import usePaperSummary from './usePaperSummary';
import usePdfInk from './usePdfInk';
import useCanvasWorkspace from './useCanvasWorkspace';
import NoteCanvas from './components/NoteCanvas';
import SourceIndexPanel from './components/SourceIndexPanel';
import ConversationSearch from './components/ConversationSearch';
import QuestionActions from './components/QuestionActions';
import QuestionReuseReview from './components/QuestionReuseReview';
import { prepareQuestionReuse, commitQuestionReuse, type QuestionReuseReview as QuestionReview } from './questionReuse';
import usePdfSearch from './usePdfSearch';
import PdfSearchBar, { PageEntry } from './components/PdfSearchBar';
import LibraryBrowser from './components/LibraryBrowser';
import DesktopMenuBar from './components/DesktopMenuBar';
import AppHelpDialog from './components/AppHelpDialog';
import { ReadingHistory, type ReadingLocation, type HistoryDirection } from './readingHistory';
import { isReadingScrollKey, resolveDesktopKey, type DesktopKeyAction } from './desktopCommands';
import { saveNavigationPage, checkHistoryPdf, historyContentReady } from './pageNavigation';
import { FocusPositionRestore, RenderPositionRestore, type FocusPosition } from './focusPosition';
import './readingFocus.css';
import { appendAIResponse, createQuestionSnapshot, flushBeforeExport, scopeDescriptions, WholePaperReader, withExtractedPages } from './readingWorkflow';
import { normalizedRects } from './readingFeatures';
import './readingFeatures.css';
import './readingWorkflow.css';
import './readingTools.css';
import './readingExperience.css';
const emptyState = (): PaperState => ({ note: '', messages: [], lastPage: 1 });
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const api = window.paperReader;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export default function App() {
    const [papers, setPapers] = useState<Paper[]>([demoPaper]);
    const [metadata, setMetadata] = useState<LibraryMetadata>({});
    const metadataCurrent = useRef<LibraryMetadata>({});
    const [metadataReady, setMetadataReady] = useState(false);
    const metadataVersion = useRef(0);
    const effectivePapers = useMemo(() => papers.map(item => applyPaperMetadata(item, metadata)), [papers, metadata]);
    const [paper, setPaper] = useState<Paper | null>(null);
    const [paperState, setPaperState] = useState<PaperState>(emptyState);
    const [readerView, setReaderView] = useState<'reader' | 'summary'>('reader');
    const [rightView, setRightView] = useState<'chat' | 'note'>('chat');
    const [rightOpen, setRightOpen] = useState(true);
    const [rightWidth, setRightWidth] = useState(330);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<'time' | 'category'>('time');
    const [bytes, setBytes] = useState<Uint8Array | null>(null);
    const pdfFile = useMemo(() => bytes ? { data: new Uint8Array(bytes) } : undefined, [bytes, readerView]);
    const [pageCount, setPageCount] = useState(1);
    const [zoom, setZoom] = useState(100);
    const history = useRef(new ReadingHistory());
    const [, refreshHistory] = useState(0);
    const viewPosition = useRef({ view: readerView, zoom }); viewPosition.current = { view: readerView, zoom };
    const historyTravel = useRef(false);
    const [focusMode, setFocusMode] = useState(false);
    const focusCurrent = useRef(false);
    const focusBusy = useRef(false);
    const [interactionMode, setInteractionMode] = useState<'read' | 'hand' | 'capture'>('read');
    const importing = useRef(false);
    const [importBusy, setImportBusy] = useState(false);
    const [searchFocus, setSearchFocus] = useState(0);
    const [helpOpen, setHelpOpen] = useState<'guide' | 'about' | null>(null);
    const commandCallback = useRef<(command: DesktopCommand) => void>(() => undefined);
    const keyCallback = useRef<(event: KeyboardEvent) => void>(() => undefined);
    const [selection, setSelection] = useState('');
    const [selectionMenu, setSelectionMenu] = useState<SelectionSnapshot | null>(null);
    const [noteReview, setNoteReview] = useState<{ paperId: string; messageId: string; originalNote: string; proposal: string } | null>(null);
    const [noteUndo, setNoteUndo] = useState<NoteAdoptionUndo | null>(null);
    const adoptionSave = useRef(new NoteAdoptionSaveGate());
    const [pageText, setPageText] = useState('');
    const [question, setQuestion] = useState('');
    const draftCurrent = useRef(''); draftCurrent.current = question;
    const paperDrafts = useRef(new Map<string, string>());
    const questionInput = useRef<HTMLTextAreaElement>(null);
    const [reuseReview, setReuseReview] = useState<QuestionReview | null>(null);
    const [reuseError, setReuseError] = useState('');
    const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
    const conversationSearchActive = useRef(false);
    const [conversationSession, setConversationSession] = useState(0);
    const [contextMode, setContextMode] = useState<AIContextMode>('page');
    const [requestStatus, setRequestStatus] = useState('');
    const [preview, setPreview] = useState<StreamPreview | null>(null);
    const progressSubscription = useRef<(() => void) | null>(null);
    const chatScroll = useRef<HTMLDivElement>(null);
    const followAnswer = useRef(true);
    const extraction = useRef<WholePaperReader | null>(null);
    if (!extraction.current) extraction.current = new WholePaperReader(id => api.readPaper(id), bytes => pdfjs.getDocument({ data: bytes }));
    const [loading, setLoading] = useState(false);
    const [stateReady, setStateReady] = useState(false);
    const [transitioning, setTransitioning] = useState(false);
    const interactionLocked = useRef(false);
    const [notice, setNotice] = useState('');
    const marks = useReadingMarks(api, setNotice);
    const summary = usePaperSummary(api, setNotice);
    const summaryStatus = useRef({ paperId: null as string | null, summaryReady: false });
    summaryStatus.current = { paperId: paper?.id ?? null, summaryReady: summary.ready && (!summary.value || summary.value.paperId === paper?.id) };
    const pdfInk = usePdfInk(api, setNotice);
    const canvas = useCanvasWorkspace(api, setNotice);
    const canvasBoardReady = !!paper && canvas.paperId === paper.id && (canvas.boardMode === 'mind-map' ? canvas.mapReady && canvas.mindMap.paperId === paper.id : canvas.ready && canvas.diagramReady && canvas.diagram.paperId === paper.id);
    const canvasBoardStatus = canvas.boardMode === 'mind-map' ? canvas.mapStatus : !canvas.ready ? canvas.status : canvas.diagramStatus;
    const canvasBoardCount = canvas.boardMode === 'mind-map' ? canvas.mindMap.nodes.length : canvas.document.objects.length + canvas.diagram.shapes.length + canvas.diagram.arrows.length + canvas.diagram.connections.length;
    const pdfSearch = usePdfSearch(api, paper && !paper.isDemo ? paper.id : null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [navigationOpen, setNavigationOpen] = useState(false);
    const navigationButton = useRef<HTMLButtonElement>(null);
    const [drawing, setDrawing] = useState(false);
    const [erasing, setErasing] = useState(false);
    const [inkColor, setInkColor] = useState('#334155');
    const [exporting, setExporting] = useState(false);
    const exportActive = useRef(false);
    const [noteTab, setNoteTab] = useState<NoteTab>('text');
    const selectedRects = useRef<{ paperId: string; page: number; rects: NormalizedRect[] } | null>(null);
    const [saveStatus, setSaveStatus] = useState('Saved locally');
    const [settings, setSettings] = useState<AppSettings>({ provider: 'deepseek', model: 'deepseek-flash', hasApiKey: false });
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [model, setModel] = useState('deepseek-flash');
    const [apiKey, setApiKey] = useState('');
    const [savingSettings, setSavingSettings] = useState(false);
    const [requestId, setRequestId] = useState<string | null>(null);
    const generalChat = useGeneralChat(api, { hasApiKey: settings.hasApiKey, onSettings: () => setSettingsOpen(true), onNotice: setNotice, isBlocked: () => interactionLocked.current || closing.current || !!current.current.paper });
    const requests = useAIRequestHistory(api, paper && !paper.isDemo && stateReady ? { scope: 'paper', paperId: paper.id } : null);
    useEffect(() => { if (stateReady && !requestId) void requests.refresh(); }, [stateReady, requestId, paperState.messages.length, requests.refresh]);
    const current = useRef<{
        paper: Paper | null;
        state: PaperState;
        loaded: boolean;
    }>({ paper: null, state: emptyState(), loaded: false });
    const loadToken = useRef(0);
    const writeQueue = useRef<Promise<void>>(Promise.resolve());
    const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeRequest = useRef<string | null>(null);
    const closing = useRef(false);
    const readerRef = useRef<HTMLDivElement>(null);
    const [readerWidth, setReaderWidth] = useState(620);
    const pdfWidth = useRef(readerWidth * zoom / 100); pdfWidth.current = readerWidth * zoom / 100;
    const readerSize = useRef({ width: 0, height: 0 });
    const renderedWidth = useRef(0);
    const focusPosition = useRef<FocusPositionRestore | null>(null);
    if (!focusPosition.current) focusPosition.current = new FocusPositionRestore(applyFocusPosition);
    const historyPosition = useRef<RenderPositionRestore<ReadingLocation & { fullscreen: boolean }> | null>(null);
    if (!historyPosition.current) historyPosition.current = new RenderPositionRestore(applyHistoryPosition);
    const conversationMessages = useMemo(() => paper?.isDemo ? [...demoInitial.messages, ...paperState.messages] : paperState.messages, [paper?.isDemo, paperState.messages]);
    useEffect(() => { if (followAnswer.current && !conversationSearchActive.current && chatScroll.current) chatScroll.current.scrollTop = chatScroll.current.scrollHeight; }, [preview, paperState.messages, rightView, rightOpen, requestStatus]);
    useEffect(() => { if (summary.value && summary.value.paperId === paper?.id) setPageCount(summary.value.pageCount); }, [summary.value, paper?.id]);
    useEffect(() => { let alive = true; Promise.all([api.listPapers(), api.getSettings()]).then(([items, config]) => { if (!alive)
        return; setPapers([demoPaper, ...items.filter(item => !item.isDemo)]); setSettings(config); setModel(config.model); }).catch(error => alive && setNotice(errorText(error))); return () => { alive = false; }; }, []);
    useEffect(() => { let alive = true; api.loadLibraryMetadata().then(value => { if (!alive) return; metadataCurrent.current = value; setMetadata(value); setMetadataReady(true); }).catch(error => { if (alive) setNotice(`Paper information is unavailable. Reading remains available: ${errorText(error)}`); }); return () => { alive = false; }; }, []);
    useEffect(() => { const active = current.current.paper; if (active) { const updated = applyPaperMetadata(active, metadata); current.current.paper = updated; setPaper(updated); } }, [metadata]);
    useEffect(() => { setSelectionMenu(null); }, [paper?.id, paperState.lastPage, readerView, zoom, drawing, interactionMode]);
    useEffect(() => {
        if (!selectionMenu) return;
        const changed = () => { if (window.getSelection()?.toString().trim() !== selectionMenu.text) { setSelectionMenu(null); setSelection(''); selectedRects.current = null; } };
        document.addEventListener('selectionchange', changed);
        return () => document.removeEventListener('selectionchange', changed);
    }, [selectionMenu]);
    useEffect(() => {
        const element = readerRef.current; if (!element) return;
        const observer = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect, previous = readerSize.current;
            if (width !== previous.width || height !== previous.height) {
                readerSize.current = { width, height }; focusPosition.current!.layout(width !== previous.width); historyPosition.current!.layout(width !== previous.width);
            }
            setReaderWidth(Math.max(300, width - 64));
        });
        observer.observe(element); return () => observer.disconnect();
    }, [paper, readerView, rightOpen, focusMode]);
    useEffect(() => { focusPosition.current!.cancel(); }, [paper?.id, paperState.lastPage, readerView]);
    useEffect(() => () => cancelPositionRestores(), []);
    function cancelPositionRestores() { focusPosition.current!.cancel(); historyPosition.current!.cancel(); }
    function matchingReaderRaster(element: HTMLElement): boolean {
        const source = element.querySelector<HTMLCanvasElement>('.react-pdf__Page__canvas'), width = source?.getBoundingClientRect().width;
        return !!source && source.style.visibility !== 'hidden' && !!width && Math.abs(width - pdfWidth.current) <= 2 && Math.abs(renderedWidth.current - width) <= 2;
    }
    function applyFocusPosition(value: FocusPosition): boolean {
        const element = readerRef.current, active = current.current.paper;
        if (!element || active?.id !== value.paperId || current.current.state.lastPage !== value.page || viewPosition.current.view !== 'reader' || focusCurrent.current !== value.fullscreen || element.closest('.app-shell')?.classList.contains('reading-focus') !== value.fullscreen) return false;
        if (!active.isDemo && !matchingReaderRaster(element)) return false;
        element.scrollTop = value.top * Math.max(0, element.scrollHeight - element.clientHeight);
        element.scrollLeft = value.left * Math.max(0, element.scrollWidth - element.clientWidth);
        recordLocation(); return true;
    }
    function applyHistoryPosition(value: ReadingLocation & { fullscreen: boolean }): boolean {
        const element = readerRef.current, active = current.current.paper;
        if (!element || active?.id !== value.paperId || current.current.state.lastPage !== value.page || viewPosition.current.view !== value.view || viewPosition.current.zoom !== value.zoom || focusCurrent.current !== value.fullscreen || element.closest('.app-shell')?.classList.contains('reading-focus') !== value.fullscreen) return false;
        if (!active.isDemo && !historyContentReady(value, summaryStatus.current)) return false;
        if (value.view === 'reader' && !active.isDemo && !matchingReaderRaster(element)) return false;
        element.scrollTop = value.scrollTop; element.scrollLeft = value.scrollLeft;
        recordLocation(); return true;
    }
    function queueHistoryPosition(value: ReadingLocation) {
        if (!value.paperId) { historyPosition.current!.cancel(); return; }
        historyPosition.current!.begin({ ...value, fullscreen: value.view === 'summary' ? false : focusCurrent.current });
        historyPosition.current!.confirm(focusCurrent.current);
    }
    function locationSnapshot(): ReadingLocation {
        return { paperId: current.current.paper?.id ?? null, page: current.current.paper ? current.current.state.lastPage : 1, view: current.current.paper ? viewPosition.current.view : 'reader', zoom: current.current.paper ? viewPosition.current.zoom : 100, scrollTop: readerRef.current?.scrollTop ?? 0, scrollLeft: readerRef.current?.scrollLeft ?? 0 };
    }
    function rememberLocation() {
        const restoring = historyPosition.current!.pending ?? focusPosition.current!.pending;
        if (restoring && restoring.paperId === current.current.paper?.id && restoring.page === current.current.state.lastPage) return;
        recordLocation();
    }
    function recordLocation() {
        const snapshot = locationSnapshot(), previous = history.current.current;
        if (previous.paperId === snapshot.paperId && previous.page === snapshot.page && previous.view === snapshot.view) history.current.update(snapshot);
    }
    function visitLocation(value: ReadingLocation) { history.current.visit(value); refreshHistory(value => value + 1); }
    function restoreReaderPosition(renderedPage?: number, generation = historyPosition.current!.generation) {
        if (renderedPage === undefined || renderedPage === current.current.state.lastPage) historyPosition.current!.rendered(generation);
    }
    useEffect(() => { if (readerView === 'summary' || paper?.isDemo) { const frame = requestAnimationFrame(() => { restoreReaderPosition(); if (paper?.isDemo) focusPosition.current!.rendered(focusPosition.current!.generation); }); return () => cancelAnimationFrame(frame); } }, [readerView, paper?.id, paperState.lastPage, zoom, focusMode, readerWidth, summary.ready, summary.value]);
    function updateState(state: PaperState) { current.current.state = state; setPaperState(state); }
    function enqueueSave(id: string, state: PaperState) {
        const snapshot = { ...state, messages: [...state.messages] };
        const task = writeQueue.current.catch(() => undefined).then(() => api.savePaperState(id, snapshot));
        writeQueue.current = task;
        task.then(() => { if (current.current.paper?.id === id)
            setSaveStatus('Saved locally'); }).catch(error => { if (current.current.paper?.id === id)
            setSaveStatus('Save failed'); setNotice(`Your notes could not be saved: ${errorText(error)}`); });
        return task;
    }
    async function flush() { finishEditing(); await adoptionSave.current.settle(); if (noteTimer.current) {
        clearTimeout(noteTimer.current);
        noteTimer.current = null;
    } const value = current.current;
        await Promise.all([value.paper && value.loaded ? enqueueSave(value.paper.id, value.state) : writeQueue.current, marks.flush(), pdfInk.flush(), canvas.flush(), generalChat.flush()]); }
    async function openPaper(next: Paper | null, target?: ReadingLocation, travelling = false): Promise<boolean> {
        if (exportActive.current || importing.current || focusBusy.current) return false;
        rememberLocation();
        let preloaded: [PromiseSettledResult<PaperState>, PromiseSettledResult<Uint8Array | null>] | null = null;
        const token = ++loadToken.current;
        interactionLocked.current = true; setTransitioning(true);
        setSelectionMenu(null); setNoteReview(null); setReuseReview(null);
        const requestWasCancelled = Boolean(activeRequest.current);
        const cancellation = Promise.all([requestWasCancelled ? cancelRequest() : Promise.resolve(), summary.cancel(), pdfSearch.cancel(), generalChat.prepareToLeave()]).then(() => undefined);
        try {
            if (!await continueLatestTransition(token, () => loadToken.current, cancellation)) return false;
            await flush();
        }
        catch (error) {
            if (token === loadToken.current) { interactionLocked.current = false; setTransitioning(false); setNotice(`Save before changing papers failed. Your current view and edits were preserved: ${errorText(error)}`); }
            return false;
        }
        if (token !== loadToken.current)
            return false;
        if (travelling && next) {
            preloaded = await Promise.allSettled([api.loadPaperState(next.id), next.isDemo ? Promise.resolve(null) : api.readPaper(next.id)]);
            if (token !== loadToken.current) return false;
            if (preloaded.some(result => result.status === 'rejected')) {
                interactionLocked.current = false; setTransitioning(false);
                setNotice('The history destination could not be loaded. Your current paper and history position were preserved.');
                return false;
            }
            const pdfResult = preloaded[1];
            if (!next.isDemo && pdfResult.status === 'fulfilled' && pdfResult.value) {
                try { await checkHistoryPdf(pdfResult.value, target?.page ?? 1, data => pdfjs.getDocument({ data })); }
                catch (error) {
                    if (token === loadToken.current) { interactionLocked.current = false; setTransitioning(false); setNotice(`The history PDF could not be loaded. Your current paper and history position were preserved: ${errorText(error)}`); }
                    return false;
                }
                if (token !== loadToken.current) return false;
            }
        }
        if (!next && focusCurrent.current) {
            try { await api.setFullscreen(false); focusCurrent.current = false; setFocusMode(false); }
            catch (error) { if (token === loadToken.current) { interactionLocked.current = false; setTransitioning(false); setNotice(`Could not leave focus: ${errorText(error)}`); } return false; }
        }
        if (token !== loadToken.current) return false;
        next = next ? applyPaperMetadata(next, metadataCurrent.current) : null;
        if (current.current.paper) paperDrafts.current.set(current.current.paper.id, draftCurrent.current);
        cancelPositionRestores();
        current.current = { paper: next, state: emptyState(), loaded: false };
        interactionLocked.current = false; setTransitioning(false);
        setPaper(next);
        setPaperState(emptyState());
        setStateReady(false);
        setBytes(null);
        setSelection('');
        setSelectionMenu(null); setNoteReview(null); setNoteUndo(null);
        selectedRects.current = null;
        setQuestion('');
        draftCurrent.current = ''; setReuseReview(null); setReuseError(''); setSelectedMessage(null); conversationSearchActive.current = false; followAnswer.current = true;
        setPageText('');
        setZoom(100);
        setDrawing(false);
        setInteractionMode('read');
        setErasing(false);
        setSearchOpen(false);
        setNavigationOpen(false);
        setContextMode('page');
        setPageCount(next?.isDemo ? 1 : next?.pageCount || 1);
        setNotice(requestWasCancelled ? 'The previous AI request was cancelled when switching papers.' : '');
        void marks.open(next?.isDemo ? null : next?.id ?? null);
        void summary.open(next?.isDemo ? null : next?.id ?? null);
        void pdfInk.open(next?.isDemo ? null : next?.id ?? null);
        void canvas.open(next?.isDemo ? null : next?.id ?? null);
        if (!next) {
            setLoading(false);
            historyPosition.current!.cancel();
            if (!travelling) visitLocation(locationSnapshot());
            return true;
        }
        setLoading(true);
        try {
            const [stateResult, pdfResult] = preloaded ?? await Promise.allSettled([
                api.loadPaperState(next.id),
                next.isDemo ? Promise.resolve(null) : api.readPaper(next.id)
            ]);
            if (token !== loadToken.current) return false;
            const errors: string[] = [];
            const recoveredState = recoverPaperState(stateResult);
            if (recoveredState) {
                current.current.loaded = true;
                setStateReady(true);
                updateState(target ? { ...recoveredState, lastPage: target.page } : recoveredState);
                const restoredDraft = paperDrafts.current.get(next.id) ?? '';
                draftCurrent.current = restoredDraft; setQuestion(restoredDraft);
                setSaveStatus('Saved locally');
            } else {
                setSaveStatus('Notes unavailable');
                errors.push('Saved notes could not be loaded. Editing is disabled to protect existing notes: ' + errorText(stateResult.status === 'rejected' ? stateResult.reason : 'Unknown state load error'));
            }
            if (pdfResult.status === 'fulfilled') {
                setBytes(pdfResult.value);
                if (next.isDemo) setPageText(demoText);
            } else {
                errors.push('The PDF copy could not be opened. Recovered notes remain available: ' + errorText(pdfResult.reason));
            }
            if (errors.length) setNotice(errors.join(' '));
            if (!errors.length) {
                if (target) { viewPosition.current = { view: target.view, zoom: target.zoom }; setReaderView(target.view); setZoom(target.zoom); queueHistoryPosition(target); }
                else { viewPosition.current = { view: readerView, zoom: 100 }; historyPosition.current!.cancel(); }
                if (!travelling) visitLocation(locationSnapshot());
                return true;
            }
            return false;
        }
        catch (error) {
            if (token === loadToken.current)
                setNotice(errorText(error));
        }
        finally {
            if (token === loadToken.current)
                setLoading(false);
        }
        return false;
    }
    async function importPaper() {
        if (importing.current || exportActive.current || interactionLocked.current || focusBusy.current || document.querySelector('[role="dialog"]')) return;
        importing.current = true; setImportBusy(true);
        try {
        const imported = await api.importPaper();
        if (imported) {
            setPapers(previous => [demoPaper, imported, ...previous.filter(item => item.id !== imported.id && !item.isDemo)]);
            importing.current = false;
            await openPaper(imported);
        }
    }
    catch (error) {
        setNotice(errorText(error));
    } finally { importing.current = false; setImportBusy(false); } }
    function changeNote(note: string) {
        if (interactionLocked.current || !current.current.loaded || !current.current.paper) return;
        updateState({ ...current.current.state, note }); setSaveStatus('Saving…');
        if (noteTimer.current) clearTimeout(noteTimer.current);
        const saveLatest = deferredPaperStateSave(current.current.paper.id, () => current.current, enqueueSave);
        noteTimer.current = setTimeout(() => { noteTimer.current = null; void saveLatest().catch(() => undefined); }, 450);
    }
    async function savePaperInformation(id: string, input: PaperMetadata) {
        if (!metadataReady) throw new Error('Paper information must load successfully before editing.');
        const version = ++metadataVersion.current;
        const updated = await api.savePaperMetadata(id, input);
        if (version === metadataVersion.current) { metadataCurrent.current = updated; setMetadata(updated); }
    }
    function reviewNoteSuggestion(message: ChatMessage) {
        const active = current.current;
        if (interactionLocked.current || !active.loaded || active.paper?.id !== message.paperId) return;
        const proposal = extractNoteProposal(message);
        if (proposal) setNoteReview({ paperId: message.paperId, messageId: message.id, originalNote: active.state.note, proposal });
    }
    async function applyNoteSuggestion(proposal: string, mode: 'append' | 'replace') {
        const review = noteReview, active = current.current;
        if (!review || interactionLocked.current || !active.loaded) throw new Error('Open the paper and review the suggestion again.');
        assertReviewPaper(review.paperId, active.paper?.id ?? null);
        const nextNote = prepareAdoption(review.originalNote, proposal, active.state.note, mode);
        const reviewedState = active.state;
        if (noteTimer.current) { clearTimeout(noteTimer.current); noteTimer.current = null; }
        setSaveStatus('Saving…');
        await adoptionSave.current.run(async () => {
            await enqueueSave(review.paperId, { ...reviewedState, note: nextNote });
            const latest = current.current;
            assertReviewPaper(review.paperId, latest.paper?.id ?? null);
            if (latest.state.note !== review.originalNote) {
                await enqueueSave(review.paperId, latest.state);
                throw new Error('Your note changed while the suggestion was saving. Your newer note was kept. Close and review the suggestion again.');
            }
            const committed = { ...latest.state, note: nextNote };
            const stateChanged = latest.state !== reviewedState;
            updateState(committed);
            try { if (stateChanged) await enqueueSave(review.paperId, committed); }
            finally {
                // The primary write succeeded; an ancillary-state failure must not leave a stale review open.
                setNoteUndo({ paperId: review.paperId, before: review.originalNote, after: nextNote });
                setNoteReview(null); setRightOpen(true); setRightView('note'); setNoteTab('text');
            }
        });
    }
    function undoNoteSuggestion() {
        const active = current.current;
        if (!noteUndo || interactionLocked.current || !active.loaded) return;
        try { const note = undoAdoption(noteUndo, active.paper?.id ?? null, active.state.note); setNoteUndo(null); changeNote(note); }
        catch (error) { setNotice(errorText(error)); }
    }
    function changeMarks(value: ReadingMarks) { if (!interactionLocked.current) marks.update(value); }
    function finishEditing() { marks.finishInk(); marks.finishEraseInk(); pdfInk.finish(); canvas.finish(); }
    function changeReaderView(value: 'reader' | 'summary') {
        if (interactionLocked.current || exportActive.current || historyTravel.current || focusBusy.current) return;
        if (viewPosition.current.view === value) return;
        if (focusCurrent.current && value === 'summary') { void toggleFocus().then(changed => { if (changed) changeReaderView(value); }); return; }
        rememberLocation(); finishEditing(); cancelPositionRestores(); viewPosition.current.view = value; setReaderView(value);
        if (current.current.paper && current.current.loaded) visitLocation({ ...locationSnapshot(), view: value, scrollTop: 0, scrollLeft: 0 });
        if (readerRef.current) { readerRef.current.scrollTop = 0; readerRef.current.scrollLeft = 0; }
    }
    function changeRightView(value: 'chat' | 'note') { finishEditing(); setRightView(value); }
    function changeNoteTab(value: NoteTab) { finishEditing(); setNoteTab(value); }
    function closeNavigation() { setNavigationOpen(false); navigationButton.current?.focus(); }
    function navigateConversation(messageId: string) {
        setSelectedMessage(messageId); followAnswer.current = false;
        const node = Array.from(chatScroll.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find(item => item.dataset.messageId === messageId);
        node?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    function changeConversationSearch(active: boolean) {
        conversationSearchActive.current = active;
        followAnswer.current = !active;
        if (!active) setSelectedMessage(null);
    }
    function fillQuestion(value: string) {
        draftCurrent.current = value; setQuestion(value); setReuseReview(null); setReuseError('');
        requestAnimationFrame(() => questionInput.current?.focus());
    }
    function reuseQuestion(value: string) {
        const active = current.current;
        if (interactionLocked.current || !active.paper || !active.loaded) return;
        try {
            const prepared = prepareQuestionReuse(active.paper.id, draftCurrent.current, value);
            if (prepared.kind === 'fill') fillQuestion(prepared.question);
            else { setReuseError(''); setReuseReview(prepared.review); }
        } catch (error) { setNotice(errorText(error)); }
    }
    function replaceQuestionDraft() {
        if (!reuseReview || interactionLocked.current || !current.current.loaded) return;
        try { fillQuestion(commitQuestionReuse(reuseReview, current.current.paper?.id ?? null, draftCurrent.current)); }
        catch (error) { setReuseError(errorText(error)); }
    }
    async function goToPage(page: number) {
        if (interactionLocked.current || exportActive.current || historyTravel.current || focusBusy.current || !current.current.loaded || !current.current.paper) return;
        const id = current.current.paper.id, token = loadToken.current, previousPage = current.current.state.lastPage;
        const next = Math.max(1, Math.min(pageCount, page));
        const valid = () => token === loadToken.current && current.current.paper?.id === id && current.current.loaded;
        rememberLocation(); interactionLocked.current = true; setTransitioning(true);
        try {
            await flush();
            const saved = await saveNavigationPage(next, () => current.current.state, state => enqueueSave(id, state), valid);
            if (!saved) return;
            updateState(saved); cancelPositionRestores();
            if (next !== previousPage) setPageText('');
            setSelection(''); setSelectionMenu(null); selectedRects.current = null; viewPosition.current.view = 'reader'; setReaderView('reader');
            const position = locationSnapshot(); visitLocation({ ...position, scrollTop: next === previousPage ? position.scrollTop : 0, scrollLeft: 0 });
            if (readerRef.current && next !== previousPage) { readerRef.current.scrollTop = 0; readerRef.current.scrollLeft = 0; }
        } catch (error) { if (valid()) setNotice(`Save before changing pages failed. Your current page was preserved: ${errorText(error)}`); }
        finally { if (token === loadToken.current) { interactionLocked.current = false; setTransitioning(false); } }
    }
    function changePage(delta: number) { goToPage(current.current.state.lastPage + delta); }
    function selectText() {
        setSelectionMenu(null);
        if (drawing || interactionMode !== 'read') return;
        const selected = window.getSelection();
        if (!selected || !readerRef.current?.contains(selected.anchorNode) || !readerRef.current?.contains(selected.focusNode)) return;
        const quote = selected.toString().trim();
        setSelection(quote); selectedRects.current = null;
        if (quote.length > 30000) { setNotice('Selected passages support up to 30,000 characters for AI. Choose a shorter passage before sending.'); return; }
        const page = readerRef.current.querySelector('.react-pdf__Page');
        if (!paper || paper.isDemo || !page || !quote || !selected.rangeCount || !page.contains(selected.anchorNode) || !page.contains(selected.focusNode)) return;
        const bounds = selected.getRangeAt(0).getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) setSelectionMenu({ paperId: paper.id, page: paperState.lastPage, text: quote, rect: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom } });
        if (quote.length > 16000) { setNotice('Choose a shorter passage (up to 16,000 characters) to highlight.'); return; }
        const rects = normalizedRects(Array.from(selected.getRangeAt(0).getClientRects()), page.getBoundingClientRect());
        if (rects.length && rects.length <= 1000) selectedRects.current = { paperId: paper.id, page: paperState.lastPage, rects };
    }
    function addHighlight() {
        if (interactionLocked.current) return;
        const geometry = selectedRects.current, store = marks.current.current;
        if (!geometry || geometry.paperId !== current.current.paper?.id || geometry.page !== current.current.state.lastPage || !selection || !store?.ready || store.id !== geometry.paperId) return;
        if (store.value.highlights.length >= 2000) { setNotice('This paper has reached the 2,000 highlight limit. Your existing highlights are preserved.'); return; }
        marks.update({ ...store.value, highlights: [...store.value.highlights, { id: crypto.randomUUID(), page: geometry.page, quote: selection, comment: '', color: 'yellow', rects: geometry.rects, createdAt: new Date().toISOString() }] });
        setRightOpen(true); setRightView('note'); setNoteTab('highlights'); setSelection(''); setSelectionMenu(null); selectedRects.current = null; window.getSelection()?.removeAllRanges();
    }
    function generateSummary() {
        if (interactionLocked.current || !paper || paper.isDemo || !summary.ready) return;
        if (!settings.hasApiKey) { setNotice('Connect your DeepSeek API key in Settings to generate a full-paper summary.'); setSettingsOpen(true); return; }
        void summary.generate(paper.id);
    }
    function selectionAction(action: SelectionAction, selected: SelectionSnapshot) {
        if (interactionLocked.current || !current.current.loaded || !isCurrentSelection(selected, current.current.paper?.id ?? null, current.current.state.lastPage)) return;
        if (window.getSelection()?.toString().trim() !== selected.text) { setSelectionMenu(null); setSelection(''); selectedRects.current = null; return; }
        if (action === 'highlight') { addHighlight(); return; }
        const prompts = { explain: 'Explain the selected passage in simple terms.', translate: 'Translate the selected passage into Chinese.', summarize: 'Summarize the selected passage concisely.' };
        void sendQuestion('ask', { selected, question: prompts[action] });
    }
    async function sendQuestion(action: AIRequest['action'] = 'ask', quick?: { selected: SelectionSnapshot; question: string }) {
        const original = current.current.paper;
        const prompt = quick?.question ?? question;
        if (interactionLocked.current || !original || !current.current.loaded || (action !== 'organize-notes' && !prompt.trim()) || activeRequest.current) return;
        if (quick && !isCurrentSelection(quick.selected, original.id, current.current.state.lastPage)) return;
        if (current.current.state.messages.length + 2 > 1000) { setNotice('Conversation message limit reached. Existing messages and your draft are preserved.'); return; }
        if (action !== 'organize-notes' && prompt.trim().length > 20000) { setNotice('Keep questions within 20,000 characters. Your draft is preserved.'); return; }
        if (!settings.hasApiKey) { setNotice('Connect your DeepSeek API key in Settings to ask a question.'); setSettingsOpen(true); return; }
        const id = crypto.randomUUID(), userMessageId = crypto.randomUUID(), assistantMessageId = crypto.randomUUID();
        let snapshot: AIRequest;
        try { snapshot = createQuestionSnapshot({ requestId: id, paper: original, state: current.current.state, question: prompt, mode: quick ? 'page' : contextMode, pageText, selection: quick?.selected.text ?? selection, action }); }
        catch (error) { setNotice(errorText(error)); return; }
        const wholePaper = snapshot.context.mode === 'paper' || snapshot.context.mode === 'paper-notes';
        if (wholePaper && original.isDemo) { setNotice('Open an imported PDF to use whole-paper context.'); return; }
        // The identity becomes active before persistence and extraction can yield.
        activeRequest.current = id; setRequestId(id); setPreview(null); followAnswer.current = true; conversationSearchActive.current = false; setSelectedMessage(null); setConversationSession(value => value + 1); setRequestStatus(wholePaper ? 'Opening the full paper…' : 'Preparing your selected context…'); setNotice('');
        if (quick) setContextMode('page');
        setSelectionMenu(null);
        setRightView('chat'); setRightOpen(true);
        const isCurrent = () => activeRequest.current === id && current.current.paper?.id === original.id && current.current.loaded;
        const unsubscribe = api.onAIProgress(event => {
            if (!isCurrent()) return;
            setPreview(previous => updateStreamPreview(previous, event, { requestId: activeRequest.current, paperId: current.current.paper?.id ?? null, loaded: current.current.loaded }));
            if (event.requestId === id && event.paperId === original.id) setRequestStatus(event.type === 'reset' && event.attempt === 2 ? 'Completing a longer answer…' : 'Writing your answer…');
        });
        progressSubscription.current = unsubscribe;
        try {
            if (action === 'organize-notes') await flush();
            if (!isCurrent()) return;
            const message: ChatMessage = { id: userMessageId, paperId: original.id, role: 'user', content: action === 'organize-notes' ? ORGANIZE_NOTES_DISPLAY_QUESTION : snapshot.question, createdAt: new Date().toISOString() };
            const next = { ...current.current.state, messages: [...current.current.state.messages, message] };
            updateState(next); await enqueueSave(original.id, next);
            if (!isCurrent()) return;
            if (action === 'ask' && !quick && draftCurrent.current.trim() === snapshot.question) { draftCurrent.current = ''; setQuestion(''); }
            if (wholePaper) {
                const pages = await extraction.current!.read(original.id, isCurrent, (page, total) => { if (isCurrent()) setRequestStatus(`Reading page ${page} of ${total}…`); });
                if (!isCurrent()) return;
                snapshot = withExtractedPages(snapshot, pages);
            }
            if (!isCurrent()) return;
            setRequestStatus('Thinking with your context…');
            const result = original.isDemo ? await api.askAI(snapshot) : await api.askRecordedAI({ request: snapshot, userMessageId, assistantMessageId });
            if (!isCurrent() || !acceptsAIResult(activeRequest.current, id, original.id, result)) return;
            setPreview(null);
            const latest = appendAIResponse(current.current.state, original.id, result.content, action === 'organize-notes', assistantMessageId);
            updateState(latest); await enqueueSave(original.id, latest);
            if (result.historyWarning) setNotice(result.historyWarning);
        } catch (error) { if (isCurrent()) setNotice(errorText(error)); }
        finally { unsubscribe(); if (progressSubscription.current === unsubscribe) progressSubscription.current = null; if (activeRequest.current === id) { activeRequest.current = null; setRequestId(null); setRequestStatus(''); setPreview(null); } }
    }
    async function retryOriginalRequest(record: AIRequestRecord) {
        const original = current.current.paper;
        if (interactionLocked.current || !original || original.isDemo || !current.current.loaded || activeRequest.current || !requests.ready) return;
        if (current.current.state.messages.length + 2 > 1000) { setNotice('Conversation message limit reached. Existing messages and your draft are preserved.'); return; }
        if (!settings.hasApiKey) { setSettingsOpen(true); setNotice('Connect DeepSeek in Settings to retry the original request.'); return; }
        const user = current.current.state.messages.find(message => message.id === record.userMessageId && message.role === 'user' && !message.isDemo);
        if (!user) { setNotice('The saved original question is unavailable.'); return; }
        const id = crypto.randomUUID(), userMessageId = crypto.randomUUID(), assistantMessageId = crypto.randomUUID();
        activeRequest.current = id; setRequestId(id); setPreview(null); setRequestStatus('Replaying the saved original request…'); setNotice('');
        followAnswer.current = true; conversationSearchActive.current = false; setSelectedMessage(null); setConversationSession(value => value + 1); setRightView('chat'); setRightOpen(true);
        const isCurrent = () => activeRequest.current === id && current.current.paper?.id === original.id && current.current.loaded;
        const unsubscribe = api.onAIProgress(event => {
            if (!isCurrent()) return;
            setPreview(previous => updateStreamPreview(previous, event, { requestId: id, paperId: original.id, loaded: true }));
            if (event.requestId === id && event.paperId === original.id) setRequestStatus('Writing a new answer to the original request…');
        });
        progressSubscription.current = unsubscribe;
        try {
            await flush(); if (!isCurrent()) return;
            const newUser: ChatMessage = { ...user, id: userMessageId, createdAt: new Date().toISOString() };
            const next = { ...current.current.state, messages: [...current.current.state.messages, newUser] };
            updateState(next); await enqueueSave(original.id, next); if (!isCurrent()) return;
            const result = await api.retryAIRequest({ owner: { scope: 'paper', paperId: original.id }, originalRequestId: record.requestId, requestId: id, userMessageId, assistantMessageId });
            if (!isCurrent() || !('paperId' in result) || !acceptsAIResult(id, id, original.id, result)) return;
            setPreview(null);
            const latest = appendAIResponse(current.current.state, original.id, result.content, record.context.action === 'organize-notes', assistantMessageId);
            updateState(latest); await enqueueSave(original.id, latest);
            if (result.historyWarning) setNotice(result.historyWarning);
        } catch (error) { if (isCurrent()) setNotice(errorText(error)); }
        finally { unsubscribe(); if (progressSubscription.current === unsubscribe) progressSubscription.current = null; if (activeRequest.current === id) { activeRequest.current = null; setRequestId(null); setRequestStatus(''); setPreview(null); } }
    }
    async function cancelRequest() {
        const id = activeRequest.current;
        if (!id) return;
        activeRequest.current = null; setRequestId(null); setRequestStatus(''); setPreview(null);
        progressSubscription.current?.(); progressSubscription.current = null;
        const results = await Promise.allSettled([api.cancelAI(id), extraction.current!.cancel()]);
        const failed = results.find(result => result.status === 'rejected');
        setNotice(failed?.status === 'rejected' ? errorText(failed.reason) : 'Request cancelled.');
    }
    async function exportNotes() {
        const original = current.current.paper;
        if (interactionLocked.current || exportActive.current || !original || original.isDemo || !current.current.loaded || !marks.ready || !pdfInk.ready || !summary.ready || activeRequest.current || summary.busy) return;
        exportActive.current = true; interactionLocked.current = true; setExporting(true); setTransitioning(true);
        try {
            const result = await flushBeforeExport([flush], () => api.exportReadingNotes(original.id));
            if (!result.canceled) setNotice(`Reading notes exported${result.fileName ? ` to ${result.fileName}` : ''}. Drawings are kept in the app.`);
        } catch (error) { setNotice(`Export stopped to protect your notes: ${errorText(error)}`); }
        finally { exportActive.current = false; interactionLocked.current = false; setExporting(false); setTransitioning(false); }
    }
    async function exportPdf() {
        const original = current.current.paper;
        if (interactionLocked.current || exportActive.current || !original || original.isDemo || !current.current.loaded || !marks.ready || !pdfInk.ready || activeRequest.current || summary.busy) return;
        exportActive.current = true; interactionLocked.current = true; setExporting(true); setTransitioning(true);
        try {
            const result = await flushBeforeExport([flush], () => api.exportAnnotatedPdf(original.id));
            if (!result.canceled) setNotice(`Annotated PDF exported${result.fileName ? ` to ${result.fileName}` : ''}. Your original PDF is unchanged.`);
        } catch (error) { setNotice(`PDF export stopped: ${errorText(error)}`); }
        finally { exportActive.current = false; interactionLocked.current = false; setExporting(false); setTransitioning(false); }
    }
    async function exportCanvas() {
        if (interactionLocked.current || exportActive.current || !current.current.loaded || !canvasBoardReady || !paper || paper.isDemo) return;
        exportActive.current = true; interactionLocked.current = true; setExporting(true); setTransitioning(true);
        try {
            await flush(); const png = await canvas.exportPng();
            const result = canvas.boardMode === 'mind-map' ? await api.exportMindMapPng(paper.id, png) : await api.exportCanvasPng(paper.id, png);
            if (!result.canceled) setNotice(`${canvas.boardMode === 'mind-map' ? 'Mind map' : 'Canvas'} exported${result.fileName ? ` to ${result.fileName}` : ''}.`);
        }
        catch (error) { setNotice(`Canvas export stopped: ${errorText(error)}`); }
        finally { exportActive.current = false; interactionLocked.current = false; setExporting(false); setTransitioning(false); }
    }
    function changePdfMode(mode: 'read' | 'hand' | 'capture') {
        if (interactionLocked.current || exportActive.current || !current.current.loaded) return;
        finishEditing(); setDrawing(false); setErasing(false); setInteractionMode(mode);
        setSelection(''); setSelectionMenu(null); selectedRects.current = null; window.getSelection()?.removeAllRanges();
    }
    async function addPdfCapture(capture: PdfCaptureInput) {
        const original = current.current.paper;
        if (interactionLocked.current || exportActive.current || !original || original.isDemo || !current.current.loaded || capture.page !== current.current.state.lastPage || !canvas.ready) throw new Error('Open an editable Canvas before adding a PDF capture.');
        interactionLocked.current = true; setTransitioning(true);
        try {
            await canvas.captureImage(capture); await canvas.flush();
            if (current.current.paper?.id !== original.id) return;
            if (focusCurrent.current) { await api.setFullscreen(false); focusCurrent.current = false; setFocusMode(false); }
            setInteractionMode('read'); setRightOpen(true); setRightView('note'); setNoteTab('canvas');
            setNotice(`PDF region added to Canvas · page ${capture.page}.`);
        } finally { interactionLocked.current = false; setTransitioning(false); }
    }
    function rememberFocusScroll(fullscreen: boolean) {
        const element = readerRef.current, active = current.current.paper;
        if (!element || !active) return;
        const previous = focusPosition.current!.pending;
        const position = previous?.paperId === active.id && previous.page === current.current.state.lastPage ? previous : { paperId: active.id, page: current.current.state.lastPage, top: element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight), left: element.scrollLeft / Math.max(1, element.scrollWidth - element.clientWidth) };
        focusPosition.current!.begin({ ...position, fullscreen });
    }
    async function toggleFocus(): Promise<boolean> {
        if (focusBusy.current || interactionLocked.current || exportActive.current || !current.current.paper || !current.current.loaded) return false;
        if (!focusCurrent.current && viewPosition.current.view !== 'reader') { setNotice('Switch to Reader to enter focus mode.'); return false; }
        const token = loadToken.current;
        focusBusy.current = true; interactionLocked.current = true; setTransitioning(true);
        try {
            const next = !focusCurrent.current;
            rememberLocation(); rememberFocusScroll(next); await flush();
            if (token !== loadToken.current) return false;
            await api.setFullscreen(next); focusCurrent.current = next; setFocusMode(next);
            return true;
        } catch (error) { focusPosition.current!.cancel(); setNotice(`Focus mode could not change: ${errorText(error)}`); return false; }
        finally { focusBusy.current = false; if (token === loadToken.current) { interactionLocked.current = false; setTransitioning(false); } }
    }
    async function travelHistory(direction: HistoryDirection) {
        if (historyTravel.current || interactionLocked.current || exportActive.current || importing.current || focusBusy.current || document.querySelector('[role="dialog"]')) return;
        const target = history.current.peek(direction);
        if (!target) return;
        rememberLocation(); historyTravel.current = true;
        let navigationToken = loadToken.current;
        try {
            if (target.paperId === current.current.paper?.id && current.current.loaded) {
                interactionLocked.current = true; setTransitioning(true); await flush();
                const saved = await saveNavigationPage(target.page, () => current.current.state, state => enqueueSave(target.paperId!, state), () => navigationToken === loadToken.current && current.current.paper?.id === target.paperId && current.current.loaded);
                if (!saved) return;
                updateState(saved);
                if (focusCurrent.current && target.view === 'summary') { await api.setFullscreen(false); focusCurrent.current = false; setFocusMode(false); }
                finishEditing(); setSelection(''); setSelectionMenu(null); selectedRects.current = null;
                viewPosition.current = { view: target.view, zoom: target.zoom }; setReaderView(target.view); setZoom(target.zoom); setPageText('');
                queueHistoryPosition(target);
            } else {
                const destination = target.paperId === null ? null : effectivePapers.find(item => item.id === target.paperId);
                if (target.paperId && !destination) throw new Error('This history paper is unavailable. Your current position was preserved.');
                navigationToken = loadToken.current + 1;
                if (!await openPaper(destination ?? null, target, true)) return;
                if (focusCurrent.current && target.view === 'summary') { await api.setFullscreen(false); focusCurrent.current = false; setFocusMode(false); }
            }
            history.current.commit(direction); refreshHistory(value => value + 1);
            if (target.view === 'summary' || !target.paperId || current.current.paper?.isDemo) requestAnimationFrame(() => restoreReaderPosition());
        } catch (error) { setNotice(`Reading history could not move: ${errorText(error)}`); }
        finally { historyTravel.current = false; if (navigationToken === loadToken.current) { interactionLocked.current = false; setTransitioning(false); } }
    }
    function openPdfSearch() {
        if (interactionLocked.current || exportActive.current || !current.current.paper || current.current.paper.isDemo || !current.current.loaded) return;
        if (viewPosition.current.view !== 'reader') changeReaderView('reader');
        changePdfMode('read'); setSearchOpen(true); setSearchFocus(value => value + 1);
    }
    function runDesktopCommand(command: DesktopCommand) {
        if (document.querySelector('[role="dialog"]') || importing.current || focusBusy.current || interactionLocked.current || exportActive.current) return;
        switch (command) {
            case 'import': void importPaper(); break;
            case 'save': if (current.current.loaded) void flush().then(() => setNotice('All current reading edits saved locally.')).catch(error => setNotice(`Save failed: ${errorText(error)}`)); else setNotice('Saved notes are unavailable. Reload them before saving.'); break;
            case 'export-notes': void exportNotes(); break;
            case 'export-pdf': void exportPdf(); break;
            case 'export-canvas': void exportCanvas(); break;
            case 'home': void openPaper(null); break;
            case 'reader': changeReaderView('reader'); break;
            case 'summary': changeReaderView('summary'); break;
            case 'toggle-assistant': finishEditing(); setRightOpen(value => !value); break;
            case 'toggle-focus': void toggleFocus(); break;
            case 'back': void travelHistory('back'); break;
            case 'forward': void travelHistory('forward'); break;
            case 'find': openPdfSearch(); break;
            case 'zoom-in': setZoom(value => Math.min(200, value + 10)); break;
            case 'zoom-out': setZoom(value => Math.max(60, value - 10)); break;
            case 'zoom-reset': setZoom(100); break;
            case 'read-mode': changePdfMode('read'); break;
            case 'pan-mode': changeReaderView('reader'); changePdfMode('hand'); break;
            case 'capture-mode': changeReaderView('reader'); changePdfMode('capture'); break;
            case 'settings': setSettingsOpen(true); break;
            case 'help': setHelpOpen('guide'); break;
            case 'about': setHelpOpen('about'); break;
            case 'close': void closeWindow(); break;
        }
    }
    commandCallback.current = runDesktopCommand;
    keyCallback.current = event => {
        const active = document.activeElement;
        const editingText = active instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable);
        if (!document.querySelector('[role="dialog"]') && isReadingScrollKey(event, editingText)) cancelPositionRestores();
        const action: DesktopKeyAction | null = resolveDesktopKey(event, {
            busy: interactionLocked.current || exportActive.current || importing.current || focusBusy.current || loading,
            hasPaper: !!paper, hasRealPaper: !!paper && !paper.isDemo && stateReady,
            hasModal: !!document.querySelector('[role="dialog"]'), settingsOpen, helpOpen: !!helpOpen,
            childEscapeLayer: !!document.querySelector('[aria-label="Cancel PDF capture"]'),
            selectionOpen: !!selectionMenu, searchOpen, navigationOpen,
            interactionMode: drawing ? 'hand' : interactionMode, focusMode: focusCurrent.current,
            editingText
        });
        if (!action) return;
        event.preventDefault(); event.stopImmediatePropagation();
        switch (action) {
            case 'dismiss-settings': if (!savingSettings) { setSettingsOpen(false); setApiKey(''); } break;
            case 'dismiss-help': setHelpOpen(null); break;
            case 'dismiss-selection': setSelectionMenu(null); setSelection(''); selectedRects.current = null; window.getSelection()?.removeAllRanges(); break;
            case 'dismiss-search': setSearchOpen(false); break;
            case 'dismiss-navigation': closeNavigation(); break;
            default: runDesktopCommand(action);
        }
    };
    useEffect(() => {
        const unsubscribe = api.onDesktopCommand(command => commandCallback.current(command));
        const fullscreen = api.onFullscreenChange(value => { focusCurrent.current = value; setFocusMode(value); focusPosition.current!.confirm(value); historyPosition.current!.confirm(value); });
        const key = (event: KeyboardEvent) => keyCallback.current(event);
        document.addEventListener('keydown', key);
        return () => { unsubscribe(); fullscreen(); document.removeEventListener('keydown', key); };
    }, []);
    useEffect(() => {
        const real = !!paper && !paper.isDemo && stateReady && !!bytes;
        const state: DesktopMenuState = { hasPaper: !!paper, hasRealPaper: real, busy: transitioning || loading || exporting || importBusy || settingsOpen || !!helpOpen || !!noteReview || !!reuseReview, canBack: history.current.canBack, canForward: history.current.canForward, focusMode, rightOpen, canvasReady: canvasBoardReady, readerView,
            notesReady: stateReady, notesExportReady: real && metadataReady && marks.ready && pdfInk.ready && summary.ready && !requestId && !summary.busy,
            pdfExportReady: real && metadataReady && marks.ready && pdfInk.ready && !requestId && !summary.busy, canvasExportReady: real && metadataReady && canvasBoardReady && !canvas.exporting };
        void api.setDesktopMenuState(state).catch(error => setNotice(`Desktop menus unavailable: ${errorText(error)}`));
    }, [paper, bytes, stateReady, transitioning, loading, exporting, importBusy, settingsOpen, helpOpen, noteReview, reuseReview, focusMode, rightOpen, canvasBoardReady, canvas.exporting, readerView, paperState.lastPage, metadataReady, marks.ready, pdfInk.ready, summary.ready, requestId, summary.busy]);
    async function saveSettings() { if (!model.trim())
        return; setSavingSettings(true); try {
        const value = await api.saveSettings({ model: model.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
        setSettings(value);
        setApiKey('');
        setSettingsOpen(false);
        setNotice('DeepSeek settings saved on this device.');
    }
    catch (error) {
        setNotice(errorText(error));
    }
    finally {
        setSavingSettings(false);
    } }
    async function closeWindow() { try {
        interactionLocked.current = true; setTransitioning(true);
        ++loadToken.current;
        await Promise.all([cancelRequest(), summary.cancel(), pdfSearch.cancel(), generalChat.prepareToLeave()]);
        await flush();
        closing.current = true;
        await api.windowControl('close');
    }
    catch (error) {
        closing.current = false;
        interactionLocked.current = false; setTransitioning(false);
        setNotice(`Save before closing failed: ${errorText(error)}`);
    } }
    function startResize(event: React.PointerEvent<HTMLDivElement>) { const start = event.clientX; const width = rightWidth; const handle = event.currentTarget; handle.setPointerCapture(event.pointerId); const move = (value: PointerEvent) => setRightWidth(Math.max(280, Math.min(440, width + start - value.clientX))); const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); }; handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); }
    useEffect(() => { const handle = (event: BeforeUnloadEvent) => { if (closing.current)
        return; event.preventDefault(); event.returnValue = ''; void closeWindow(); }; window.addEventListener('beforeunload', handle); return () => window.removeEventListener('beforeunload', handle); }, []);
    useEffect(() => () => { const id = activeRequest.current; activeRequest.current = null; progressSubscription.current?.(); progressSubscription.current = null; void extraction.current!.cancel(); if (id) void api.cancelAI(id).catch(() => undefined); }, []);
    return <div className={`app-shell${focusMode ? ' reading-focus' : ''}`}>
  <header className="titlebar">
    <div className="history-controls">
    <button className="icon-button" aria-label="Reading history back" title="Back · Alt+Left" disabled={!history.current.canBack || transitioning || loading || exporting || importBusy} onClick={() => void travelHistory('back')}><ArrowLeft size={16}/></button>
    <button className="icon-button" aria-label="Reading history forward" title="Forward · Alt+Right" disabled={!history.current.canForward || transitioning || loading || exporting || importBusy} onClick={() => void travelHistory('forward')}><ArrowRight size={16}/></button>
    </div>
    <button className="icon-button home-button" title="Back to welcome" aria-label="Back to welcome" onClick={() => void openPaper(null)}>
    <Home size={16}/>
    </button>
    <div className="brand">
    <span className="brand-mark">
    <BookOpen size={18}/>
    </span>
    <strong>paper<span>reader</span>
    </strong>
    <span className="brand-divider"/>
    <span className="brand-caption">A little clarity, every page.</span>
    </div>
    <DesktopMenuBar api={api} disabled={transitioning || exporting || importBusy || settingsOpen || !!helpOpen || !!noteReview || !!reuseReview} onNotice={setNotice}/>
    <div className="window-actions">
    <button aria-label="Minimize window" onClick={() => void api.windowControl('minimize')}>
    <Minus size={15}/>
    </button>
    <button aria-label="Maximize or restore window" onClick={() => void api.windowControl('maximize')}>
    <Maximize2 size={13}/>
    </button>
    <button className="close-window" aria-label="Close window" onClick={() => void closeWindow()}>
    <X size={16}/>
    </button>
    </div>
    </header>
  <div className="workspace">
    <aside className="sidebar">
    <div className="section-label">
    <BookOpen size={16}/> WORKSPACE</div>
    <button className={`nav-button ${readerView === 'reader' ? 'active' : ''}`} onClick={() => changeReaderView('reader')}>
    <BookOpen size={18}/>Reader</button>
    <button className={`nav-button ${readerView === 'summary' ? 'active' : ''}`} onClick={() => changeReaderView('summary')}>
    <FileText size={18}/>Summary</button>
    <div className="sidebar-separator"/>
    <div className="library-title">
    <span>
    <Library size={17}/>Library</span>
    <button className="icon-button" aria-label="Import PDF" title="Import PDF" onClick={() => void importPaper()}>
    <Plus size={17}/>
    </button>
    </div>
    <label className="search-box">
    <Search size={14}/>
    <input aria-label="Search library" placeholder="Find a paper…" value={query} onChange={event => setQuery(event.target.value)}/>
    </label>
    <div className="sort-controls">
    <button className={sort === 'time' ? 'selected' : ''} onClick={() => setSort('time')}>
    <Clock3 size={13}/>Recent</button>
    <button className={sort === 'category' ? 'selected' : ''} onClick={() => setSort('category')}>
    <Tag size={13}/>Category</button>
    </div>
    <LibraryBrowser api={api} papers={effectivePapers} paper={paper} query={query} sort={sort} metadataReady={metadataReady} onMetadataSave={savePaperInformation} onOpen={item => void openPaper(item)} onImport={() => void importPaper()} onNotice={setNotice}/>
    <div className="sidebar-bottom">
    <div className="local-label">
    <span />Local workspace</div>
    <button onClick={() => setSettingsOpen(true)}>
    <Settings size={17}/>Settings<span className={settings.hasApiKey ? 'connected-dot' : 'offline-dot'}/>
    </button>
    </div>
    </aside>
  <main className="main-workspace">{!paper ? <Welcome onImport={() => void importPaper()} onDemo={() => void openPaper(demoPaper)} generalChat={<GeneralChatPanel workspace={generalChat} model={settings.model} disabled={transitioning || loading || exporting}/>}/> : <>
        <div className="reading-grid" style={{ gridTemplateColumns: rightOpen ? `minmax(0,1fr) 8px ${rightWidth}px` : 'minmax(0,1fr)' }}>
        <section className="reader-panel reading-pane">
        <div className="reader-toolbar">
        <span className="document-icon">
        <FileText size={20}/>
        </span>
        <div className="document-title">
        <strong title={paper.title}>{paper.title}</strong>
        <small title={paper.fileName}>{paper.isDemo ? 'Demo paper · Original illustrative content' : [paper.authors, paper.year, paper.fileName].filter(Boolean).join(' · ')}</small>
        </div>
        <div className="reader-tools">{readerView === 'reader' && <>
            <button className="icon-button" aria-label="Previous page" disabled={paperState.lastPage <= 1} onClick={() => changePage(-1)}>
            <ChevronLeft size={16}/>
            </button>
            <PageEntry page={paperState.lastPage} pageCount={pageCount} disabled={transitioning || loading || !stateReady} onNavigate={goToPage}/>
            <button className="icon-button" aria-label="Next page" disabled={paperState.lastPage >= pageCount} onClick={() => changePage(1)}>
            <ChevronRight size={16}/>
            </button>
            <span className="tool-divider"/>
            <button className="icon-button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(60, value - 10))}>
            <ZoomOut size={17}/>
            </button>
            <button className="zoom-value" title="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</button>
            <button className="icon-button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(200, value + 10))}>
            <ZoomIn size={17}/>
            </button>
            </>}<button className={`icon-button focus-toggle${focusMode ? ' active' : ''}`} aria-label={focusMode ? 'Exit reading focus' : 'Enter reading focus'} title={focusMode ? 'Exit focus · F11 / Escape' : 'Reading focus · F11'} disabled={transitioning || loading || !stateReady || readerView !== 'reader'} onClick={() => void toggleFocus()}>{focusMode ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
            <button className="icon-button assistant-toggle" aria-label={rightOpen ? 'Hide assistant panel' : 'Show assistant panel'} onClick={() => { finishEditing(); setRightOpen(value => !value); }}>{rightOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button>
        </div>
        </div>
        {readerView === 'reader' && !paper.isDemo && <div className="pdf-ink-toolbar">
            <div className="pdf-mode-controls">
              <button aria-label="Read PDF" aria-pressed={!drawing && interactionMode === 'read'} className={!drawing && interactionMode === 'read' ? 'active' : ''} onClick={() => changePdfMode('read')}><BookOpen size={12}/>Read</button>
              <button aria-label="Hand tool" aria-pressed={interactionMode === 'hand'} className={interactionMode === 'hand' ? 'active' : ''} disabled={transitioning || loading || !stateReady} onClick={() => changePdfMode('hand')}><Hand size={12}/>Hand</button>
              <button aria-label="Capture PDF region" aria-pressed={interactionMode === 'capture'} className={interactionMode === 'capture' ? 'active' : ''} disabled={transitioning || loading || !stateReady || !canvas.ready} onClick={() => changePdfMode('capture')}><ScanLine size={12}/>Capture</button>
              <button aria-label="Draw on PDF" aria-pressed={drawing && !erasing} className={drawing && !erasing ? 'active' : ''} disabled={transitioning || loading || !pdfInk.ready} onClick={() => { changePdfMode('read'); setDrawing(true); setErasing(false); }}><PenLine size={12}/>Draw</button>
              <button aria-label="Erase PDF strokes" title="Erase whole strokes; undo is available" aria-pressed={drawing && erasing} className={drawing && erasing ? 'active' : ''} disabled={transitioning || loading || !pdfInk.ready} onClick={() => { changePdfMode('read'); setDrawing(true); setErasing(true); }}><Eraser size={12}/>Erase</button>
            </div>
            <div className="ink-colors">{[{ name: 'Slate', value: '#334155' }, { name: 'Coral', value: '#ed6376' }, { name: 'Mint', value: '#4b8f82' }].map(color => <button key={color.value} aria-label={`${color.name} PDF pen`} aria-pressed={inkColor === color.value} disabled={!drawing || erasing || transitioning} className={inkColor === color.value ? 'selected' : ''} style={{ '--pen-color': color.value } as React.CSSProperties} onClick={() => setInkColor(color.value)}/>)}</div>
            <button className="icon-button" aria-label="Undo PDF stroke" disabled={transitioning || !pdfInk.canUndo(paperState.lastPage) || !!pdfInk.draft} onClick={() => pdfInk.undo(paperState.lastPage)}><Undo2 size={14}/></button><button className="icon-button" aria-label="Redo PDF stroke" disabled={transitioning || !pdfInk.canRedo(paperState.lastPage) || !!pdfInk.draft} onClick={() => pdfInk.redo(paperState.lastPage)}><Redo2 size={14}/></button>
            <small>{drawing ? `${erasing ? 'Erase whole strokes' : 'Draw'} on page ${paperState.lastPage} · ` : 'PDF ink · '}{pdfInk.status}</small>
            <div className="reading-tool-actions"><button ref={navigationButton} aria-label="PDF contents" aria-controls="pdf-navigation" aria-expanded={navigationOpen} disabled={transitioning || loading || !bytes} onClick={() => { finishEditing(); setNavigationOpen(value => !value); }}><BookOpen size={12}/>Contents</button><button aria-label="Find in PDF" aria-expanded={searchOpen} disabled={transitioning || loading || !bytes} onClick={() => { pdfInk.finish(); setDrawing(false); setSearchOpen(value => !value); }}><Search size={12}/>Find</button><button aria-label="Export annotated PDF" disabled={exporting || transitioning || loading || !bytes || !stateReady || !marks.ready || !pdfInk.ready || !!requestId || summary.busy} onClick={() => void exportPdf()}><Download size={12}/>{exporting ? 'Exporting…' : 'Export PDF'}</button></div>
            <details className="pdf-export-help"><summary>About PDF export</summary><p>Save to a new file name. The copy keeps searchable text, highlights, PDF drawings and comments. Visible marks are flattened; edit them here in Paper Reader. The separate Note Ink pad is excluded. Your original PDF stays unchanged.</p></details>
        </div>}
        {readerView === 'reader' && !paper.isDemo && searchOpen && <PdfSearchBar search={pdfSearch} disabled={transitioning || loading || !stateReady} focusToken={searchFocus} onClose={() => setSearchOpen(false)} onNavigate={goToPage}/>}
        <div className="reader-body">
        {readerView === 'reader' && !paper.isDemo && bytes && navigationOpen && <PdfNavigation key={paper.id} api={api} paperId={paper.id} page={paperState.lastPage} disabled={transitioning || loading || !stateReady} onNavigate={goToPage} onClose={closeNavigation}/>}
        <div ref={readerRef} className={`reader-content ${readerView === 'summary' ? 'summary-content' : ''}`} onWheel={cancelPositionRestores} onPointerDownCapture={cancelPositionRestores} onScroll={rememberLocation} onMouseUp={selectText}>{loading ? <div className="pane-empty">
            <span className="loading-dot"/>Opening your paper…</div> : readerView === 'summary' ? paper.isDemo ? <SummaryView /> : <PaperSummaryView summary={summary.value} ready={summary.ready} busy={summary.busy} status={summary.status} onGenerate={generateSummary} onCancel={() => void summary.cancel()} onRetry={() => void summary.open(paper.id)} onPage={goToPage} sources={<SourceIndexPanel key={paper.id} api={api} paperId={paper.id} disabled={transitioning || loading || !stateReady || exporting} onPage={goToPage}/>}/> : paper.isDemo ? <div className="demo-scale" style={{ width: `${zoom}%` }}>
            <DemoArticle />
            </div> : bytes ? <PdfReader key={paper.id} file={pdfFile} page={paperState.lastPage} width={readerWidth * zoom / 100} highlights={marks.value.highlights} searchQuery={searchOpen ? pdfSearch.highlightQuery : ''} interactionMode={interactionMode} scrollElement={readerRef.current} onCapture={addPdfCapture} onRendered={page => {
                if (current.current.paper?.id !== paper.id || current.current.state.lastPage !== page) return;
                const generation = focusPosition.current!.generation;
                const historyGeneration = historyPosition.current!.generation;
                renderedWidth.current = readerRef.current?.querySelector<HTMLCanvasElement>('.react-pdf__Page__canvas')?.getBoundingClientRect().width ?? 0;
                requestAnimationFrame(() => {
                    if (current.current.paper?.id !== paper.id || current.current.state.lastPage !== page) return;
                    restoreReaderPosition(page, historyGeneration); focusPosition.current!.rendered(generation);
                });
            }} ink={{ strokes: pdfInk.value.strokes, draft: pdfInk.draft, drawing: drawing && pdfInk.ready && !transitioning && !loading, erasing, onBegin: (point, bounds) => !interactionLocked.current && (erasing ? pdfInk.beginErase(paper.id, paperState.lastPage, point, bounds) : pdfInk.begin(paper.id, paperState.lastPage, inkColor, point)), onPoint: (point, bounds) => erasing ? pdfInk.erasePoint(point, bounds) : pdfInk.point(point), onFinish: pdfInk.finish }} onLoaded={count => {
                if (current.current.paper?.id !== paper.id) return;
                setPageCount(count); if (current.current.loaded && current.current.state.lastPage > count) updateState({ ...current.current.state, lastPage: count });
            }} onText={(page, text) => { if (current.current.paper?.id === paper.id && current.current.state.lastPage === page) setPageText(text); }} onError={error => { if (current.current.paper?.id === paper.id) setNotice(`PDF could not be opened: ${error.message}`); }}/> : <div className="pane-empty">
            <FileText size={28}/>
            <p>Unable to display this PDF.</p>
            <button className="secondary-button" onClick={() => void openPaper(paper)}>Try again</button>
            </div>}</div>
        </div>
        <div className="reader-status">
        <span>
        <span className="status-dot"/>{readerView === 'summary' ? 'Summary view' : paper.isDemo ? 'Original HTML demonstration' : 'Text-based PDF · Local file'}</span>
        <span>{interactionMode === 'hand' ? 'Drag the page to move around' : interactionMode === 'capture' ? 'Drag a region, then add it to Canvas' : selection ? `${selection.length} characters selected` : 'Select a passage to ask about it'}</span>
        </div>
        </section>{rightOpen && <>
            <div className="resize-handle" onPointerDown={startResize} role="separator" aria-label="Resize assistant panel" aria-orientation="vertical"/>
            <aside className="assistant-panel">
            <div className="right-tabs">
            <button className={rightView === 'chat' ? 'active' : ''} onClick={() => changeRightView('chat')}>
            <MessageCircle size={17}/>Chat</button>
            <button className={rightView === 'note' ? 'active' : ''} onClick={() => changeRightView('note')}>
            <StickyNote size={17}/>Note</button>
            </div>{rightView === 'chat' ? <>
                <div className="assistant-heading">
                <span className="assistant-avatar">
                <Sparkles size={16}/>
                </span>
                <div>
                <strong>Reading assistant</strong>
                <small>{settings.hasApiKey ? settings.model : 'Connect DeepSeek to begin'}</small>
                </div>
                <button className="icon-button" aria-label="AI connection settings" onClick={() => setSettingsOpen(true)}>
                <Settings size={15}/>
                </button>
                </div>
                <ConversationSearch key={`${paper.id}:${conversationSession}`} paperId={paper.id} messages={conversationMessages} disabled={transitioning || loading || !stateReady} onNavigate={navigateConversation} onActiveChange={changeConversationSearch}/>
                {!paper.isDemo && requests.error && <div className="request-history-error" role="alert"><p>Saved original requests are unavailable: {requests.error}</p><button disabled={!!requestId || transitioning} onClick={() => void requests.refresh()}>Retry request history</button></div>}
                <div ref={chatScroll} className="chat-scroll" onScroll={event => { const node = event.currentTarget; if (!conversationSearchActive.current) followAnswer.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }}>{!paper.isDemo && paperState.messages.length === 0 && <div className="chat-empty">
                    <span className="chat-orbit">
                    <Sparkles size={27}/>
                    </span>
                    <h3>A question is a good start.</h3>
                    <p>Ask about a passage, unpack a term,<br />or find the argument on this page.</p>
                    <button onClick={() => setQuestion('What is the main argument on this page?')}>What is the main argument?<ChevronRight size={13}/>
                    </button>
                    <button onClick={() => setQuestion('Explain the key terms on this page.')}>Explain the key terms<ChevronRight size={13}/>
                    </button>
                    </div>}{conversationMessages.map(message => <div className={`chat-message ${message.role}${selectedMessage === message.id ? ' conversation-selected' : ''}`} key={message.id} data-message-id={message.id}>
                    <div className="message-label">{message.role === 'assistant' ? <Bot size={14}/> : null}<strong>{message.role === 'assistant' ? 'Assistant' : 'You'}</strong>
                    <span>{message.isDemo ? 'DEMO' : new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {message.role === 'assistant' ? <MarkdownContent content={message.content}/> : <p>{message.content}</p>}
                    {message.role === 'assistant' && <div className="message-actions"><CopyAnswer content={message.content} copy={api.copyText}/>{extractNoteProposal(message) && <button className="review-note-action" aria-label="Review suggestion" disabled={transitioning || loading || !stateReady || !!requestId} onClick={() => reviewNoteSuggestion(message)}><StickyNote size={12}/>Review suggestion</button>}</div>}
                    {message.role === 'user' && <><QuestionActions content={message.content} disabled={transitioning || loading || !stateReady} onReuse={reuseQuestion}/>{paper.isDemo || requests.ready ? <RequestRetryButton record={requests.recordForMessage(message.id)} disabled={transitioning || loading || !stateReady || !!requestId || !requests.ready} onRetry={record => void retryOriginalRequest(record)}/> : <small>{requests.error ? 'Request history unavailable' : 'Loading original requests…'}</small>}</>}
                    </div>)}{requestId && preview?.requestId === requestId && preview.content && <div className="chat-preview" aria-label="Answer in progress"><div className="message-label"><Bot size={14}/><strong>Assistant</strong><span>IN PROGRESS</span></div><MarkdownContent content={preview.content}/></div>}{requestId && <div className="thinking" role="status">
                    <span className="loading-dot"/>{requestStatus}</div>}</div>
                <div className="assistant-footer">
                <span className={settings.hasApiKey ? 'connected-dot' : 'offline-dot'}/>{settings.hasApiKey ? 'DeepSeek key configured' : 'Your API key is not connected'}<button onClick={() => setSettingsOpen(true)}>{settings.hasApiKey ? 'Manage' : 'Connect'}</button>
                </div>
                </> : <ReadingNotes paperId={paper.id} note={paperState.note} placeholder={paper.isDemo ? demoInitial.note : 'Capture an idea, a question, or a passage to revisit…'} noteReady={!transitioning && !loading && stateReady} noteStatus={saveStatus} marks={marks.value} marksReady={!transitioning && !paper.isDemo && marks.ready} marksStatus={paper.isDemo ? 'Open a PDF to add marks' : marks.status} tab={noteTab} onTab={changeNoteTab} onNote={changeNote} onMarks={changeMarks} canvas={<NoteCanvas onSourcePage={goToPage} onExport={() => void exportCanvas()} workspace={canvas} disabled={transitioning || loading || !stateReady || paper.isDemo || exporting}/>} canvasReady={!transitioning && !loading && !paper.isDemo && canvasBoardReady} canvasStatus={paper.isDemo ? "Open a PDF to use Canvas" : canvasBoardStatus} canvasCount={canvasBoardCount} undoAdoption={noteUndo ? { enabled: canUndoAdoption(noteUndo, paper.id, paperState.note), onUndo: undoNoteSuggestion } : undefined} ink={{ draft: marks.draft, onBegin: (color, point) => !interactionLocked.current && marks.beginInk(paper.id, color, point), onPoint: marks.inkPoint, onFinish: marks.finishInk, onEraseBegin: (point, bounds) => !interactionLocked.current && marks.beginEraseInk(paper.id, point, bounds), onErasePoint: marks.eraseInkPoint, onEraseFinish: marks.finishEraseInk, onUndo: marks.undoInk, onRedo: marks.redoInk, canUndo: marks.canUndoInk, canRedo: marks.canRedoInk }} highlightEditing={{ onColor: marks.setHighlightColor, onRemove: marks.removeHighlight, onUndo: marks.undoHighlight, onRedo: marks.redoHighlight, canUndo: marks.canUndoHighlight, canRedo: marks.canRedoHighlight }} onPage={goToPage} onSave={() => void flush().catch(() => undefined)} onNotice={setNotice} onOrganize={() => void sendQuestion('organize-notes')} organizing={!!requestId} onExport={() => void exportNotes()} exporting={exporting} exportReady={!transitioning && !loading && !paper.isDemo && stateReady && marks.ready && pdfInk.ready && summary.ready && !summary.busy && !requestId}/>}</aside>
            </>}</div>
        <div className="composer">
        <div className="context-strip">
        <label className="context-choice">Context<select aria-label="AI context" value={contextMode} disabled={transitioning || !!requestId} onChange={event => setContextMode(event.target.value as AIContextMode)}><option value="page">Current page</option><option value="paper" disabled={paper.isDemo}>Whole paper</option><option value="notes">Notes only</option><option value="paper-notes" disabled={paper.isDemo}>Paper + notes</option></select></label>
        {contextMode === 'page' && <>
        <span>
        <FileText size={12}/>{selection ? 'Selected passage' : 'Current page'} · {paperState.lastPage}</span>{selection && <>
            <span className="selection-preview">{selection}</span>
            <button onClick={() => setQuestion('Explain the selected passage in simple terms.')}>Explain</button>
            <button onClick={() => setQuestion('Translate the selected passage into Chinese.')}>Translate</button>
            {!paper.isDemo && <button className="highlight-action" disabled={transitioning || !marks.ready || !selectedRects.current} onClick={addHighlight}>Highlight</button>}
            <button className="icon-button" aria-label="Clear selection" onClick={() => { setSelection(''); setSelectionMenu(null); selectedRects.current = null; window.getSelection()?.removeAllRanges(); }}>
            <X size={12}/>
            </button>
            </>}</>}
        </div>
        <div className="context-disclosure">{scopeDescriptions[contextMode]}{(contextMode === 'paper' || contextMode === 'paper-notes') && <span> Up to 200 pages / 240,000 text characters. Image-only pages have no readable text.</span>}</div>
        <div className="composer-input">
        <Sparkles size={18}/>
        <textarea ref={questionInput} aria-label="Question about this paper" placeholder={contextMode === 'page' ? 'Ask a question about this page…' : contextMode === 'notes' ? 'Ask about your text notes…' : 'Ask a question about this paper…'} disabled={transitioning || !stateReady || loading || !!reuseReview} value={question} onChange={event => { draftCurrent.current = event.target.value; setQuestion(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void sendQuestion();
        } }}/>{requestId ? <button className="send-button cancel" aria-label="Cancel AI request" onClick={() => void cancelRequest()}>
            <X size={17}/>
            </button> : <button className="send-button" aria-label="Send question" disabled={!question.trim() || loading || transitioning || !stateReady} onClick={() => void sendQuestion()}>
            <ArrowUp size={19}/>
            </button>}</div>
        </div>
        </>}{notice && <div className="notice" role="status">
        <span>{notice}</span>
        <button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}>
        <X size={15}/>
        </button>
        </div>}</main>
    </div>
  <SelectionToolbar selection={paper && readerView === 'reader' && !drawing && isCurrentSelection(selectionMenu, paper.id, paperState.lastPage) ? selectionMenu : null} onAction={selectionAction} onDismiss={() => setSelectionMenu(null)} disabled={transitioning || loading || !stateReady || !!requestId} canHighlight={marks.ready && !!selectedRects.current}/>
  {noteReview && paper?.id === noteReview.paperId && <NoteSuggestionReview paperId={noteReview.paperId} originalNote={noteReview.originalNote} proposal={noteReview.proposal} disabled={transitioning || loading || !stateReady} onApply={applyNoteSuggestion} onClose={() => setNoteReview(null)}/>}
  {reuseReview && paper?.id === reuseReview.paperId && <QuestionReuseReview review={reuseReview} disabled={transitioning || loading || !stateReady} error={reuseError} onReplace={replaceQuestionDraft} onCancel={() => { setReuseReview(null); setReuseError(''); }}/>}
  {helpOpen && <AppHelpDialog mode={helpOpen} onClose={() => setHelpOpen(null)}/>}
  {settingsOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !savingSettings) {
            setSettingsOpen(false);
            setApiKey('');
        } }}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-top">
        <span className="feature-icon">
        <Settings size={23}/>
        </span>
        <button className="icon-button" aria-label="Close settings" disabled={savingSettings} onClick={() => { setSettingsOpen(false); setApiKey(''); }}>
        <X size={19}/>
        </button>
        </div>
        <span className="eyebrow">MAKE IT YOURS</span>
        <h2 id="settings-title">Your AI connection.</h2>
        <p>Bring your own DeepSeek key. Reading and notes work without one.</p>
        <label>Provider<div className="provider-field">
        <span className="connected-dot"/>DeepSeek<span>api.deepseek.com</span>
        </div>
        </label>
        <label htmlFor="model">Model<input id="model" value={model} onChange={event => setModel(event.target.value)}/>
        </label>
        <label htmlFor="key">API key<span className="field-hint">{settings.hasApiKey ? 'Key configured · leave blank to keep it' : 'No key configured'}</span>
        <input id="key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? 'Enter a replacement key' : 'Paste your DeepSeek API key'}/>
        </label>
        <div className="privacy-note">
        <BookOpen size={15}/>
        <span>The key is encrypted on this device. Sending shares the selected context with DeepSeek: page, full paper, notes, or paper plus notes. Notes only excludes paper text and recent chat.</span>
        </div>
        <button className="primary-button modal-save" disabled={!model.trim() || savingSettings} onClick={() => void saveSettings()}>{savingSettings ? 'Saving…' : 'Save connection'}<Check size={16}/>
        </button>{notice && <p className="settings-error" role="status">{notice}</p>}</section>
        </div>}
 </div>;
}


