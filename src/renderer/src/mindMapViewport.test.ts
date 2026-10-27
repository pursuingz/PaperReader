import test from 'node:test'
import assert from 'node:assert/strict'
import { fitMindMap, panMindMap, zoomMindMap } from './mindMapViewport'
import { layoutMindMap } from './mindMapModel'

test('Mind map wheel zoom keeps the same world point beneath the cursor and clamps magnification',()=>{
 const before={x:-30,y:200,zoom:.8},point={x:135,y:90},world={x:before.x+point.x/before.zoom,y:before.y+point.y/before.zoom}
 for(const target of [.000001,.4,2,100]){const after=zoomMindMap(before,point,target);assert.ok(after.zoom>=.01&&after.zoom<=4);assert.ok(Math.abs(after.x+point.x/after.zoom-world.x)<1e-8);assert.ok(Math.abs(after.y+point.y/after.zoom-world.y)<1e-8)}
})
test('Mind map pan follows the pointer at every zoom without mutating hierarchy or full export layout',()=>{
 const map={version:1 as const,paperId:'paper-a',nodes:[{id:'root',parentId:null,order:0,text:'Root'},{id:'child',parentId:'root',order:0,text:'Child'}]},snapshot=JSON.stringify(map),layout=layoutMindMap(map)
 const before={x:80,y:40,zoom:2},after=panMindMap(before,{x:60,y:-20});assert.deepEqual(after,{x:50,y:50,zoom:2});assert.equal(JSON.stringify(map),snapshot);assert.deepEqual(layoutMindMap(map),layout)
})
test('Fit map contains the complete layout in compact and expanded viewports',()=>{
 for(const size of [{width:250,height:220},{width:1100,height:700}]){const layout={width:4096,height:4096},view=fitMindMap(layout,size);assert.ok((0-view.x)*view.zoom>=0);assert.ok((0-view.y)*view.zoom>=0);assert.ok((layout.width-view.x)*view.zoom<=size.width+1e-7);assert.ok((layout.height-view.y)*view.zoom<=size.height+1e-7)}
})
