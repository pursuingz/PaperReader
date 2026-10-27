import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

import { cp,mkdir,access } from 'node:fs/promises'
const localInputResources = {name:'paper-reader-local-input',async closeBundle(){
 const source=resolve(__dirname,'resources/local-input'),destination=resolve(__dirname,'out/local-input');await access(resolve(source,'prepared.json'));await mkdir(destination,{recursive:true});for(const name of ['whisper','vision','licenses','manifest.json','prepared.json'])await cp(resolve(source,name),resolve(destination,name),{recursive:true,filter:file=>!file.endsWith('.part')})
}}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['pdf-lib'] }),localInputResources] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()], publicDir: resolve(__dirname, 'node_modules/pdfjs-dist/web/images'), build: { assetsInlineLimit: 0 } }
})
