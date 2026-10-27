import type { NormalizedRect } from './types'
export interface AIWorldRegion { x:number; y:number; width:number; height:number }
export type AIImageOrigin = {kind:'pdf-capture';page:number;rect:NormalizedRect} | {kind:'canvas';pageId:string;pageName:string;region:AIWorldRegion}
export interface AIImageInput { bytes:Uint8Array; origin:AIImageOrigin }
export interface AIImageReference { imageId:string; sha256:string; mimeType:'image/png'|'image/jpeg'; width:number; height:number; byteLength:number; origin:AIImageOrigin }
export interface AIImageData extends AIImageReference { bytes:Uint8Array }
export interface ChatNotesSelection { text:boolean;highlights:boolean;mindMap:boolean;canvas:boolean;canvasScope:'current'|'selected'|'all';canvasPageIds:string[] }
export interface ChatNotesSnapshot {
 version:1;selection:ChatNotesSelection;
 text?:string;
 highlights?:Array<{id:string;page:number;quote:string;comment:string}>;
 mindMap?:{nodes:Array<{id:string;parentId:string|null;order:number;text:string}>};
 canvas?:Array<{pageId:string;name:string;content:string}>;
 images:AIImageReference[];
 coverage:{canvasPageIds:string[];imageCount:number};
}
export const DEFAULT_CHAT_NOTES_SELECTION:ChatNotesSelection={text:true,highlights:true,mindMap:true,canvas:true,canvasScope:'current',canvasPageIds:[]}
export const AI_IMAGE_LIMIT=8
export const AI_IMAGE_BYTES_LIMIT=10*1024*1024
export const AI_IMAGES_TOTAL_BYTES_LIMIT=16*1024*1024
