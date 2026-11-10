const {test}=require('node:test'),assert=require('node:assert/strict')
const {affiliateSalesNotice,affiliateSalesNoticeMessages}=require('../dist/services/AffiliateSalesNotifications')
const {affiliateSalesSlot}=require('../dist/services/AffiliateSalesObserver')
const sale=(changes={})=>({key:'a'.repeat(64),productId:'MLB123456789',title:'Panela',saleValueBRL:100,commissionBRL:10,units:2,status:'EM REVISÃO',attribution:'indirect',...changes})
test('notices include pending and indirect sales now, deduplicate and exclude cancellation and ambiguous money',()=>{
 const item=sale(),body=affiliateSalesNotice([item,item,sale({key:'b'.repeat(64),status:'CANCELADA pelo comprador'}),sale({key:'c'.repeat(64),productId:'MLB987654321',title:'Garrafa',observationAmbiguous:true,observationStatuses:['EM REVISÃO'],commissionBRL:900})])
 assert.match(body,/2 venda\(s\)/);assert.match(body,/1 indireta/);assert.match(body,/Panela/);assert.match(body,/Garrafa/);assert.match(body,/100,00/);assert.match(body,/10,00/);assert.doesNotMatch(body,/900,00/);assert.match(body,/não são valores recebidos/);assert.match(body,/parciais\/incertos/)
 assert.equal(affiliateSalesNotice([sale({status:'CANCELADA'}),sale({observationAmbiguous:true,observationStatuses:['EM REVISÃO','CANCELADA']})]),null)
})
test('messages are bounded, remove title controls/links and do not invent missing quantities or commissions',()=>{
 const messages=affiliateSalesNoticeMessages(Array.from({length:20},(_,i)=>sale({key:String(i),productId:'MLB'+i,title:'*Nome*\nhttps://unsafe.invalid/path',units:null,commissionBRL:null})))
 const body=messages.join('\n');assert.ok(messages.every(message=>message.length<3200));assert.doesNotMatch(body,/https:|unsafe|\/ \d+ un\./);assert.equal((body.match(/• Nome/g)||[]).length,20);assert.match(body,/20 venda\(s\) com valores ausentes/)
})
test('3/6/12 hour slots align to São Paulo and survive restarts within the same slot',()=>{
 const a=affiliateSalesSlot(new Date('2026-11-10T14:59:00Z'),6),b=affiliateSalesSlot(new Date('2026-11-10T15:00:00Z'),6)
 assert.equal(a.key,'h6-06');assert.equal(b.key,'h6-12');assert.equal(b.start.toISOString(),'2026-11-10T15:00:00.000Z');assert.equal(affiliateSalesSlot(new Date('2026-11-10T15:45:00Z'),6).key,b.key)
 assert.equal(affiliateSalesSlot(new Date('2026-11-10T05:00:00Z'),12).key,'h12-00');assert.equal(affiliateSalesSlot(new Date('2026-11-10T06:00:00Z'),3).key,'h3-03');assert.throws(()=>affiliateSalesSlot(new Date(),4))
})
