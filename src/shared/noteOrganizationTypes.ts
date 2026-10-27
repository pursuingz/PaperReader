export interface NoteOrganizationBlock {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
}

export interface NoteOrganizationRecipe {
  readonly version: 1
  readonly processingVersion: 'faithful-blocks-v1'
  readonly source: string
  readonly blocks: readonly NoteOrganizationBlock[]
  readonly prompts: Readonly<{ system: string; plan: string; organize: string; repair: string }>
  readonly limits: Readonly<{
    maxSourceChars: number
    maxBlocks: number
    maxBlockChars: number
    maxChunkChars: number
    maxChunkBlocks: number
    maxPlanChars: number
    maxOutputChars: number
    maxRepairAttempts: number
  }>
}

export interface NoteOrganizationJsonRequest {
  system: string
  user: string
  signal?: AbortSignal
}

export type NoteOrganizationRequestJson = (request: NoteOrganizationJsonRequest) => Promise<unknown>
