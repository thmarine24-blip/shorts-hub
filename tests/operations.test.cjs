// Executes the actual persistence/deletion handlers with a mocked GitHub boundary.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/app.js'),'utf8');
async function deletion(fail){
  const button={},values={pending:[{id:'job'}],jobs:[{id:'job'}]},messages=[];let sent;
  const ctx={console,Date,JSON,Object,setTimeout:()=>0,currentJob:()=>({id:'job',state:'failed',title:'Failed job'}),$:()=>button,
    store:{get:(k,d)=>values[k]??d,set:(k,v)=>values[k]=v},jobs:[{id:'job'}],ensureMedia:async()=>{},mediaFiles:async()=>({'jobs/job/status.json':'sha'}),
    commitMedia:async changes=>{sent=changes;if(fail)throw Error('offline');},closeViewer:()=>{},renderList:()=>{},toast:(...a)=>messages.push(a),refresh:()=>{}};
  vm.createContext(ctx);const start=source.indexOf('let delArmed = 0;'),end=source.indexOf('async function jobScript',start);
  vm.runInContext(source.slice(start,end),ctx);await button.onclick();await button.onclick();
  assert(sent['deleted/job.json']);assert.equal(sent['jobs/job/status.json'],null);
  if(fail){assert.equal(values.pending.length,1);assert.equal(values.dismissed,undefined);assert(messages.at(-1)[0].includes('Could not delete'));}
  else{assert.equal(values.pending.length,0);assert(values.dismissed.job);assert.equal(ctx.jobs.length,0);}
}
async function commitRace(){
  let calls=0,patches=0;const ctx={setTimeout:fn=>fn(),Object,Error,Promise,mediaHead:async()=>`h${calls++}`,mediaFiles:async()=>({'jobs/a/status.json':'sha'}),
    gh:async(path,options)=>{if(path.startsWith('/git/commits/')&&!options)return{tree:{sha:'tree'}};
      if(options?.method==='PATCH'){assert.equal(options.body.force,false);if(patches++===0){const e=Error('race');e.status=422;throw e;}}return {sha:'next'};}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function commitMedia('),source.indexOf('async function dispatch(')),ctx);
  await ctx.commitMedia({'jobs/a/status.json':null,'deleted/a.json':'{}'},'delete');assert.equal(patches,2);
}
(async()=>{await deletion(false);await deletion(true);await commitRace();console.log('PASS: durable failed-attempt deletion, honest save failure, fast-forward race retry');})().catch(e=>{console.error(e);process.exitCode=1;});
