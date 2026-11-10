const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID,createHash}=require('node:crypto')
require('reflect-metadata')
process.env.DATABASE_URL??='postgresql://authqa:authqa-local-only@127.0.0.1:55439/authqa'
assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))
const {sequelize}=require('../dist/database'),{User}=require('../dist/database/models/User'),{AffiliateSalesNotifications}=require('../dist/services/AffiliateSalesNotifications'),{AffiliateSalesState}=require('../dist/services/AffiliateSalesState'),{DailyAutomationAlerts}=require('../dist/services/DailyAutomationAlerts')
test('durable baseline, atomic notification cursor/outbox, no replay after restart, partial capture or uncertain transport',async()=>{
 const user=await User.create({name:'Notice QA',email:`${randomUUID()}@notices.invalid`,passwordHash:'unused'}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'sales-notices-')),previous=process.env.DAILY_BROWSER_STATE_PATH
 process.env.DAILY_BROWSER_STATE_PATH=path.join(directory,'auth/session.json')
 const store=new AffiliateSalesState(path.join(directory,'affiliate-sales','account-'+user.id),user.id),service=new AffiliateSalesNotifications(),config={userId:user.id,alertGroupId:'120363000000000000@g.us'},now=new Date('2026-11-10T14:00:00Z')
 const sale=(id,time,status='EM REVISÃO')=>({key:createHash('sha256').update(id).digest('hex'),productId:'MLB123456789',title:'Panela QA',saleDateLabel:'10/nov',saleDate:'2026-11-10',saleValueBRL:100,commissionBRL:10,units:1,status,attribution:'indirect',firstSeenAt:time,lastSeenAt:time})
 const capture=async(sales,time,complete=true)=>store.publish({generationId:randomUUID(),userId:user.id,observedAt:time,reportRange:{from:'2026-08-12',to:'2026-11-10'},complete,malformedRows:0,rows:sales.length,sales})
 const count=async()=>Number((await sequelize.query("SELECT count(*) FROM daily_automation_alerts WHERE user_id=:id",{replacements:{id:user.id}}))[0][0].count)
 try{
  const old=sale('old','2026-11-10T12:00:00Z'),fresh=sale('fresh','2026-11-10T13:00:00Z')
  await capture([old],old.firstSeenAt);await service.tick(config,now);assert.equal(await count(),0,'Historical baseline is silent')
  await capture([old,fresh],fresh.firstSeenAt,false);await service.tick(config,now);assert.equal(await count(),0,'Partial capture cannot announce new sales')
  await capture([old,fresh],fresh.firstSeenAt)
  const query=sequelize.query.bind(sequelize);sequelize.query=(sql,...args)=>String(sql).startsWith('UPDATE affiliate_sales_notice_cursors')?Promise.reject(new Error('synthetic crash')):query(sql,...args)
  try{await assert.rejects(service.tick(config,now),/synthetic crash/)}finally{sequelize.query=query}
  assert.equal(await count(),0,'Outbox and cursor roll back together')
  await Promise.all([service.tick(config,now),new AffiliateSalesNotifications().tick(config,now)])
  assert.equal(await count(),1,'Concurrent/restarted workers enqueue once')
  const [messages]=await sequelize.query('SELECT body FROM daily_automation_alerts WHERE user_id=:id',{replacements:{id:user.id}})
  assert.match(messages[0].body,/1 venda\(s\)/);assert.match(messages[0].body,/Panela QA/);assert.match(messages[0].body,/10,00/)
  await capture([old,{...fresh,status:'CANCELADA pelo comprador'},sale('cancelled','2026-11-10T13:30:00Z','CANCELADA')],'2026-11-10T13:30:00Z');await service.tick(config,now);assert.equal(await count(),1,'Status revisions never announce the same purchase twice; cancellations are excluded')
  let transports=0;const alerts=new DailyAutomationAlerts({requireConnectedCreds:async()=>({})},{requireCurrentGroups:async()=>[]},{sendText:async()=>{transports++;throw new Error('uncertain')}})
  await alerts.dispatch(config);await alerts.dispatch(config);assert.equal(transports,1,'Unknown transport is never replayed')
  const [rows]=await sequelize.query('SELECT status FROM daily_automation_alerts WHERE user_id=:id',{replacements:{id:user.id}});assert.equal(rows[0].status,'UNKNOWN')
 }finally{if(previous===undefined)delete process.env.DAILY_BROWSER_STATE_PATH;else process.env.DAILY_BROWSER_STATE_PATH=previous;await User.destroy({where:{id:user.id}});await fs.rm(directory,{recursive:true,force:true});await sequelize.close()}
})
