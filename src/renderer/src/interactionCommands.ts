import type { InteractionCommand } from '../../shared/localInputTypes'
import type { VoiceSession } from './voiceSession'
export interface InteractionCommandsOptions {
  voice: VoiceSession
  isSuspended(): boolean
  previousPage(): void
  nextPage(): void
  scrollReader(delta: number): void
}
export class InteractionCommands {
  constructor(private readonly options: InteractionCommandsOptions) {}
  async execute(command: InteractionCommand): Promise<void> {
    if (this.options.isSuspended()) return
    switch (command) {
      case 'previous-page': this.options.previousPage(); break
      case 'next-page': this.options.nextPage(); break
      case 'scroll-up': this.options.scrollReader(-360); break
      case 'scroll-down': this.options.scrollReader(360); break
      case 'start-voice': if (!this.options.voice.recording) await this.options.voice.start(); break
      case 'stop-voice-and-send': if (this.options.voice.recording) await this.options.voice.stop(true); break
    }
  }
}
