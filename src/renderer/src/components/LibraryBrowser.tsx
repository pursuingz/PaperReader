import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, FileText, MoreHorizontal, Pencil, Plus, Upload, X } from 'lucide-react'
import type { DesktopAPI, LibraryOrganization, Paper, PaperMetadata } from '../../../shared/types'
import { groupLibrary } from '../readingWorkflow'
import { groupRecentLibrary } from '../libraryMetadata'
import PaperInformationEditor from './PaperInformationEditor'
import '../libraryMetadata.css'

interface Props { api: DesktopAPI; papers: Paper[]; paper: Paper | null; query: string; sort: 'time' | 'category'; metadataReady: boolean; onMetadataSave(paperId: string, input: PaperMetadata): Promise<void>; onOpen(paper: Paper): void; onImport(): void; onNotice(message: string): void }
export default function LibraryBrowser({ api, papers, paper, query, sort, metadataReady, onMetadataSave, onOpen, onImport, onNotice }: Props) {
  const [organization, setOrganization] = useState<LibraryOrganization>({ categories: [], assignments: {} })
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [actionMenu, setActionMenu] = useState<string | null>(null), [editingPaper, setEditingPaper] = useState<Paper | null>(null)
  const actionContainer = useRef<HTMLDivElement>(null)
  const [localDay, setLocalDay] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const now = new Date(), midnight = new Date(now)
      setLocalDay(now); midnight.setDate(midnight.getDate() + 1); midnight.setHours(0, 0, 0, 0)
      timer = setTimeout(refresh, midnight.getTime() - now.getTime() + 50)
    }
    refresh(); window.addEventListener('focus', refresh)
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh) }
  }, [])
  const actionButtons = useRef(new Map<string, HTMLButtonElement>())
  const load = async () => {
    setReady(false); setFailed(false)
    try { setOrganization(await api.loadLibraryOrganization()); setReady(true) }
    catch (error) { setFailed(true); onNotice(`Categories could not be loaded. Changes are disabled to protect your library: ${String(error)}`) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { setActionMenu(null) }, [query, sort, paper?.id, metadataReady])
  useEffect(() => {
    if (!actionMenu) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !actionContainer.current?.contains(event.target)) setActionMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { const button = actionContainer.current?.querySelector<HTMLButtonElement>('.paper-actions-button'); setActionMenu(null); button?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    actionContainer.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [actionMenu])
  const closeInformation = () => { const id = editingPaper?.id; setEditingPaper(null); if (id) actionButtons.current.get(id)?.focus() }
  const mutate = async (operation: () => Promise<LibraryOrganization>, done?: () => void) => {
    if (!ready || busy) return
    setBusy(true)
    try { setOrganization(await operation()); done?.() }
    catch (error) { onNotice(String(error)) }
    finally { setBusy(false) }
  }
  const labelFor = (item: Paper) => organization.categories.find(category => category.id === organization.assignments[item.id])?.name ?? 'Imported / unassigned'
  const filtered = papers.filter(item => `${item.title} ${item.authors ?? ''} ${item.year ?? ''} ${labelFor(item)}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.importedAt.localeCompare(a.importedAt))
  const item = (value: Paper) => <div key={value.id} className={`library-paper-row ${paper?.id === value.id ? 'selected' : ''}`}>
    <button className={`paper-item ${paper?.id === value.id ? 'selected' : ''}`} title={value.title} onClick={() => onOpen(value)}><span className="pdf-mark"><FileText size={17}/></span><span className="paper-item-text"><strong>{value.isDemo ? 'Explore the demo' : value.title}</strong><small>{value.isDemo ? 'Original sample · 1 page' : sort === 'category' ? labelFor(value) : [value.authors, value.year].filter(Boolean).join(' · ') || 'Imported PDF'}</small></span></button>
    {!value.isDemo && <div className="paper-actions" ref={actionMenu === value.id ? actionContainer : undefined}><button ref={element => { if (element) actionButtons.current.set(value.id, element); else actionButtons.current.delete(value.id) }} className="paper-actions-button" aria-label={`Paper actions: ${value.title}`} aria-haspopup="menu" aria-expanded={actionMenu === value.id} title={metadataReady ? 'Paper actions' : 'Paper information unavailable'} disabled={!metadataReady} onClick={() => setActionMenu(previous => previous === value.id ? null : value.id)}><MoreHorizontal size={15}/></button>{actionMenu === value.id && <div className="paper-actions-menu" role="menu"><button role="menuitem" onClick={() => { setActionMenu(null); setEditingPaper(value) }}><Pencil size={13}/>Edit paper information</button></div>}</div>}
  </div>
  return <div className="library-list">
    {sort === 'category' && <div className="category-editor">
      {!ready && <p className="category-load-status">{failed ? 'Categories unavailable. Editing is disabled.' : 'Loading categories…'}{failed && <button className="text-action" onClick={() => void load()}>Retry categories</button>}</p>}
      <form onSubmit={event => { event.preventDefault(); void mutate(() => api.createCategory(newName), () => setNewName('')) }}><input aria-label="New category name" placeholder="New category…" maxLength={80} value={newName} disabled={!ready || busy} onChange={event => setNewName(event.target.value)}/><button aria-label="Create category" title="Create category" disabled={!ready || busy || !newName.trim()}><Plus size={14}/></button></form>
      {paper && !paper.isDemo && <label>FILE THIS PAPER<select aria-label="Paper category" value={organization.assignments[paper.id] ?? ''} disabled={!ready || busy} onChange={event => { const paperId = paper.id, categoryId = event.target.value || null; void mutate(() => api.assignPaperCategory(paperId, categoryId)) }}><option value="">Imported / unassigned</option>{organization.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
    </div>}
    {(sort === 'category' && ready ? groupLibrary(filtered, organization) : groupRecentLibrary(filtered, localDay)).map(group => <section className="library-group" key={group.id}>
      <div className="group-label"><ChevronDown size={13}/><strong>{group.name}</strong><span>{group.papers.length}</span>{sort === 'category' && organization.categories.some(category => category.id === group.id) && <button aria-label={`Rename category ${group.name}`} title="Rename category" disabled={!ready || busy} onClick={() => { setRenaming(group.id); setName(group.name) }}><Pencil size={11}/></button>}</div>
      {renaming === group.id && <form className="category-rename" onSubmit={event => { event.preventDefault(); void mutate(() => api.renameCategory(group.id, name), () => setRenaming(null)) }}><input aria-label="Category name" value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)}/><button aria-label="Save category name" disabled={busy || !name.trim()}><Check size={13}/></button><button type="button" aria-label="Cancel category rename" onClick={() => setRenaming(null)}><X size={13}/></button></form>}
      {group.papers.map(item)}{sort === 'category' && !group.papers.length && <p className="category-empty">No papers here yet.</p>}
    </section>)}
    {filtered.length === 0 && <p className="library-empty">No papers match your search.</p>}<button className="import-library" onClick={onImport}><Upload size={14}/>Import a PDF</button>
    {editingPaper && <PaperInformationEditor paper={editingPaper} onSave={onMetadataSave} onClose={closeInformation}/>}
  </div>
}
