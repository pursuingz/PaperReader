import test from 'node:test'
import assert from 'node:assert/strict'
import { carouselWheelDelta, summaryMessage, renderSummaryMessage } from './summaryLocale'
test('carousel wheel moves horizontally only while room remains and normalizes line/page wheels',()=>{
 const base={left:0,width:200,content:600,deltaX:0,deltaY:40,mode:0}
 assert.equal(carouselWheelDelta(base),40)
 assert.equal(carouselWheelDelta({...base,deltaY:-40}),null)
 assert.equal(carouselWheelDelta({...base,left:400}),null)
 assert.equal(carouselWheelDelta({...base,left:400,deltaY:-40}),-40)
 assert.equal(carouselWheelDelta({...base,deltaY:2,mode:1}),48)
 assert.equal(carouselWheelDelta({...base,deltaY:1,mode:2}),200)
 assert.equal(carouselWheelDelta({...base,content:100}),null)
})

test('Async status messages follow current UI language rather than the language at request start',()=>{
 const saved=summaryMessage('Crops saved locally.','裁切已保存至本地。')
 assert.equal(renderSummaryMessage('en',saved),'Crops saved locally.')
 assert.equal(renderSummaryMessage('zh',saved),'裁切已保存至本地。')
 assert.equal(renderSummaryMessage('en','Source caption'), 'Source caption')
})
