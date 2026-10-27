import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentOwner, AgentTask } from '../shared/agentTypes'
import { agentId, ownedAgentPath, readAgentJson, writeAgentJson } from './agentStorage'
import { sameAgentOwner, validateAgentOwner, validateAgentTask } from './agentValidation'
export class AgentTaskStore {
 readonly directory:string
 constructor(readonly root:string){this.directory=join(root,'agent-tasks')}
 async save(task:AgentTask):Promise<void>{validateAgentTask(task);await ownedAgentPath(this.root,this.directory);await mkdir(this.directory,{recursive:true});const entries=await readdir(this.directory);if(entries.filter(x=>/^[\w-]+\.json$/.test(x)).length>=1000&&!entries.includes(task.id+'.json'))throw Error('Task storage quota reached');await writeAgentJson(this.root,join(this.directory,agentId(task.id)+'.json'),task)}
 async load(id:string,owner:AgentOwner,reconcile=true):Promise<AgentTask>{validateAgentOwner(owner);const value=await readAgentJson(this.root,join(this.directory,agentId(id)+'.json'));if(!value)throw Error('Task not found');validateAgentTask(value);if(value.id!==id||!sameAgentOwner(value.input.owner,owner))throw Error('Task owner does not match');if(reconcile&&(value.status==='running'||value.status==='queued')){value.status='interrupted';value.error='Execution interrupted. Continue explicitly to resume unresolved work.';for(const step of value.steps)if(step.status==='running'){step.status='failed';step.error='Interrupted operation; inspect actual artifacts before retry.'}await this.save(value)}return structuredClone(value)}
 async list(owner:AgentOwner,reconcile=true):Promise<AgentTask[]>{validateAgentOwner(owner);await ownedAgentPath(this.root,this.directory);let entries:string[];try{entries=await readdir(this.directory)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}const tasks:AgentTask[]=[];for(const name of entries.filter(x=>/^[\w-]+\.json$/.test(x)).slice(0,1000)){const value=await readAgentJson(this.root,join(this.directory,name));validateAgentTask(value);if(sameAgentOwner(value.input.owner,owner))tasks.push(await this.load(value.id,owner,reconcile))}return tasks.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
}
