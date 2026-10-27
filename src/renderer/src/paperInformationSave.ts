import type { PaperMetadata } from '../../shared/types'

interface SaveActions {
  metadata(paperId:string,input:PaperMetadata):Promise<void>
  category(paperId:string,categoryId:string|null):Promise<void>
}
const sameMetadata=(a:PaperMetadata,b:PaperMetadata)=>a.title===b.title&&a.authors===b.authors&&a.year===b.year
const reason=(error:unknown)=>error instanceof Error?error.message:String(error)

/** Tracks successful writes while the editor retains any unsaved part of its draft. */
export class PaperInformationSaveSession {
  private metadata:PaperMetadata
  private saving=false
  constructor(private readonly paperId:string,metadata:PaperMetadata,private categoryId?:string|null){this.metadata={...metadata}}
  captureCategory(categoryId:string|null){if(this.categoryId===undefined)this.categoryId=categoryId}
  async save(metadata:PaperMetadata,categoryId:string|null|undefined,actions:SaveActions):Promise<void>{
    if(this.saving)throw new Error('Paper information is already being saved.')
    if(categoryId!==undefined&&this.categoryId===undefined)throw new Error('Categories must load successfully before changing the assignment.')
    const input={...metadata}
    this.saving=true
    try {
      if(!sameMetadata(this.metadata,input)){
        try{await actions.metadata(this.paperId,input)}
        catch(error){throw new Error(`Paper information could not be saved. The category has not been changed. ${reason(error)}`)}
        this.metadata=input
      }
      if(categoryId!==undefined&&categoryId!==this.categoryId){
        try{await actions.category(this.paperId,categoryId)}
        catch(error){throw new Error(`Paper information is saved, but the category could not be saved. Your selection is retained; retry Save information. ${reason(error)}`)}
        this.categoryId=categoryId
      }
    }finally{this.saving=false}
  }
}
