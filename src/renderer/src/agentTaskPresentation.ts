import type { AgentRunInput,AgentTask,AgentOwner } from '../../shared/agentTypes'
import type { AIRequest } from '../../shared/types'
export function agentChatInput(owner:AgentOwner,question:string,selectedIds:string[],snapshot?:AIRequest):AgentRunInput{
 const images=[...new Map([...(snapshot?.attachments??[]),...(snapshot?.context.notesSnapshot?.images??[])].map(i=>[i.imageId,i])).values()]
 let history=snapshot?.history.slice(-20)??[];while(history.reduce((sum,m)=>sum+m.content.length,0)>60000)history=history.slice(1)
 return{owner,instruction:question,scope:{paperIds:[...new Set(selectedIds)],library:selectedIds.length===0,folderToken:'managed'},language:/[\u3400-\u9fff]/.test(question)?'zh':'en',network:true,allowedOperations:['read','scan','search','import','classify','reclassify','summary','new-notes','append-notes','organize-notes','export'],outputs:[],...(snapshot?{context:JSON.stringify({paperTitle:snapshot.context.paperTitle,context:snapshot.context}),history}:{}),...(images.length?{images}:{})}
}
export function agentChatContent(task:AgentTask):string{return task.answer}
