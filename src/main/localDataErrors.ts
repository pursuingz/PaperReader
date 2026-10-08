/** Native filesystem messages contain paths; renderer feedback should explain the operation. */
export async function localDataOperation<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      throw new Error(`${label} local files could not be accessed or saved. Existing files were preserved; check access and try again.`)
    }
    throw error
  }
}
