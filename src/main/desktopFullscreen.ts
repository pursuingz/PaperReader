interface FullscreenEvents {
  on(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown
  removeListener(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown
}
/** Windows may emit the native event before isFullScreen() reflects its new state. */
export function watchNativeFullscreen(owner: FullscreenEvents, notify: (fullscreen: boolean) => void): () => void {
  const enter = () => notify(true), leave = () => notify(false)
  owner.on('enter-full-screen', enter); owner.on('leave-full-screen', leave)
  return () => { owner.removeListener('enter-full-screen', enter); owner.removeListener('leave-full-screen', leave) }
}
