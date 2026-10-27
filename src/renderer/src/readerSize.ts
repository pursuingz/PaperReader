interface ReaderSizingElement { getBoundingClientRect(): { width: number }; clientHeight: number }
interface ReaderBoxStyle { paddingLeft?: string; paddingRight?: string; borderLeftWidth?: string; borderRightWidth?: string }
export function stableReaderSize(element: ReaderSizingElement, style: ReaderBoxStyle): { width: number; height: number; renderWidth: number } {
 const inset=(value?:string)=>{const n=Number.parseFloat(value??'0');return Number.isFinite(n)?Math.max(0,n):0}
 const outer=element.getBoundingClientRect().width
 const width=Number.isFinite(outer)?Math.max(0,Math.floor(outer-inset(style.paddingLeft)-inset(style.paddingRight)-inset(style.borderLeftWidth)-inset(style.borderRightWidth))):0
 const height=Number.isFinite(element.clientHeight)?Math.max(0,element.clientHeight):0
 return {width,height,renderWidth:Math.max(300,width-64)}
}
