import type { SummaryLanguage } from '../../shared/types'
export const summaryTitles = {
 en: { keywords:'Keywords',overview:'Overview',background:'Background',methods:'Methods',results:'Results',limitations:'Limitations' },
 zh: { keywords:'关键词',overview:'概览',background:'背景',methods:'方法',results:'结果',limitations:'局限' }
} as const
export const summaryTitle = (language:SummaryLanguage,id:string):string => summaryTitles[language][id as keyof typeof summaryTitles.en] ?? id
export const summaryText = (language:SummaryLanguage,english:string,chinese:string) => language==='zh'?chinese:english
/** Translate the vertical wheel only while this strip has horizontal room in its direction. */
export function carouselWheelDelta(input:{left:number;width:number;content:number;deltaX:number;deltaY:number;mode:number}):number|null {
 const raw=Math.abs(input.deltaY)>=Math.abs(input.deltaX)?input.deltaY:input.deltaX
 const amount=raw*(input.mode===1?24:input.mode===2?input.width:1)
 const max=Math.max(0,input.content-input.width)
 if(!Number.isFinite(amount)||amount===0||max<=1||(amount<0&&input.left<=1)||(amount>0&&input.left>=max-1))return null
 return amount
}

export type SummaryMessage = string | {en:string;zh:string}
export const summaryMessage=(en:string,zh:string):SummaryMessage=>({en,zh})
export const renderSummaryMessage=(language:SummaryLanguage,message:SummaryMessage):string=>typeof message==='string'?message:message[language]
