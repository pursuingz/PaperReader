export interface VoiceDraftRevisionState { paperText: string; paperRevision: number; generalText: string; generalRevision: number }
export function readVoiceDraftRevision(state:VoiceDraftRevisionState,scope:'paper'|'general',text:string):number {
 const textKey=scope==='paper'?'paperText':'generalText',revisionKey=scope==='paper'?'paperRevision':'generalRevision'
 if(state[textKey]!==text){state[textKey]=text;state[revisionKey]++}
 return state[revisionKey]
}
