import {useEffect,useRef,useState} from 'react'
import type {DesktopAPI,LibraryActivity} from '../../shared/types'
const empty=():LibraryActivity=>({version:1,lastOpenedAt:{}})
export default function useLibraryActivity(api:Pick<DesktopAPI,'loadLibraryActivity'|'recordPaperOpened'>,report:(message:string)=>void){
 const [value,setValue]=useState(empty),[error,setError]=useState(''),[ready,setReady]=useState(false),epoch=useRef(0),mounted=useRef(false)
 async function load(){const token=++epoch.current;setReady(false);try{const next=await api.loadLibraryActivity();if(mounted.current&&token===epoch.current){setValue(next);setError('');setReady(true)}}catch{if(mounted.current&&token===epoch.current){setError('Recent-open records are unavailable. Your papers are preserved. Retry after recovery.');setReady(true)}}}
 async function record(id:string){const token=++epoch.current;try{const next=await api.recordPaperOpened(id);if(mounted.current&&token===epoch.current){setValue(next);setError('');setReady(true)}}catch{if(mounted.current&&token===epoch.current){const message='The paper opened, but its recent-open time could not be saved. Existing records were preserved.';setError(message);setReady(true);report(message)}}}
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;++epoch.current}},[api])
 return{value,error,ready,load,record}
}
