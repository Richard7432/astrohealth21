import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from './dist/server/index.js';

const schema=(await readFile('drizzle/0000_mission.sql','utf8')).replaceAll('--> statement-breakpoint','');
function runtime(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
  const prepare=query=>({bind:(...values)=>({
    first:async()=>sqlite.prepare(query).get(...values)??null,
    run:async()=>({meta:{changes:sqlite.prepare(query).run(...values).changes}}),
  })});
  const pending=[];
  const env={DB:{prepare,batch:async all=>Promise.all(all.map(s=>s.run()))}};
  const ctx={waitUntil:p=>pending.push(p)};
  const use=(path,options={})=>worker.fetch(new Request('https://astrohealth.example'+path,options),env,ctx);
  return {env,ctx,use,finish:()=>Promise.all(pending)};
}
async function browser(run){
  const main=await run.use('/');
  const cookie=main.headers.get('Set-Cookie').split(';')[0];
  return {
    main, cookie,
    get:async path=>(await run.use(path,{headers:{Cookie:cookie}})).json(),
    mutate:async (body,path='/api/action')=>{
      const response=await run.use(path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:'https://astrohealth.example'},body:JSON.stringify(body)});
      return [response.status,await response.json()];
    },
  };
}

test('serves the current web project, scoped browser and public fixtures',async()=>{
  const run=runtime(), a=await browser(run), b=await browser(run);
  assert.match(await a.main.text(),/AHCC \/ 0\.5\.1/);
  assert.match((await run.use('/earthrise.webp')).headers.get('content-type'),/image\/webp/);
  assert.notEqual(a.cookie,b.cookie);
  const first=await a.get('/api/state');
  assert.notEqual(first.session.id,(await b.get('/api/state')).session.id);
  assert.equal(first.session.id,(await a.get('/api/state')).session.id);
  assert.equal(first.records.filter(r=>r.metric_code==='thermal'&&r.value===null).length,2);
  assert.match((await b.get('/api/state?session='+first.session.id)).error,/indisponível/);
  assert.equal((await a.get('/api/state?crew=B07')).session.astronaut_id,'B07');
});

test('guided sequence and receiver preserve data after a page reload',async()=>{
  const run=runtime(), visitor=await browser(run);
  const action=(op,details={})=>visitor.mutate({crew:'A12',op,...details});
  const [status,created]=await action('guide_start');
  assert.equal(status,200);
  for(let step=0;step<7;step++){
    assert.equal((await action('guide_next',{expected_step:step}))[0],200);
    const s=await visitor.get('/api/state');
    if(step===1)assert.equal(s.records.filter(r=>r.metric_code==='thermal'&&r.value===null).length,2);
    if(step===3)assert.equal(s.session.link,0);
    if(step===4)assert(s.records.every(r=>r.state==='sent'&&!r.ack_at));
    if(step===5)assert(s.records.every(r=>r.state==='confirmed'&&r.attempts===2));
  }
  const s=await visitor.get('/api/state');
  assert.equal(s.session.id,created.session_id);
  assert.equal(s.session.phase,'recuperação');
  assert(s.records.some(r=>r.kind==='checkin'));
  assert(s.records.some(r=>r.kind==='review'));
  assert(s.records.some(r=>r.phase==='recuperação'));
});

test('laboratory rejects wrong units and cross-origin writes',async()=>{
  const run=runtime(), visitor=await browser(run);
  const action=(op,details={})=>visitor.mutate({crew:'A12',op,...details});
  assert.equal((await action('fail',{mode:'unit'}))[0],422);
  assert.equal((await action('fail',{mode:'conflict'}))[0],409);
  let state=await visitor.get('/api/state');
  const shoe=state.devices.find(d=>d.type==='left');
  assert.equal((await action('device',{mode:'offline',device:shoe.id}))[0],200);
  state=await visitor.get('/api/state');
  assert.equal(state.records.findLast(r=>r.metric_code==='left_force').value,null);
  assert.notEqual(state.records.findLast(r=>r.metric_code==='right_force').value,null);
  const rejection=await run.use('/api/action',{method:'POST',headers:{Origin:'https://elsewhere.example'},body:'{}'});
  assert.equal(rejection.status,403);
});

test('external modes keep public data, cached data and unavailable credentials distinct',async()=>{
  const run=runtime(), visitor=await browser(run);
  assert.equal((await visitor.get('/api/environment/status')).services.kp.status,'unconfigured');
  const query=(mode,body)=>visitor.mutate(body,'/api/environment/'+mode);
  assert.equal((await query('weather',{lat:-23.5,lon:-46.6,model:'mm-euro1k',horizon:'0'}))[1].status,'coverage');
  assert.equal((await query('kp',{}))[1].status,'unconfigured');
  const fetch=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    assert.equal(options.redirect,'manual');
    if(url.startsWith('https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR?'))return Response.json([]);
    assert.match(url,/planetarycomputer\.microsoft\.com\/api\/stac\/v1\/search/);
    return Response.json({type:'FeatureCollection',features:[{id:'FIXTURE_ONLY',collection:'landsat-c2-l2',properties:{datetime:'2024-06-10T10:00:00Z'}}]});
  };
  try{
    assert.equal((await query('donki',{event:'FLR',start:'2024-05-10',end:'2024-05-11'}))[1].status,'empty');
    const s={collection:'landsat-c2-l2',bbox:[-9.32,38.65,-9,38.87],start:'2024-06-01',end:'2024-06-30'};
    const [,data]=await query('stac',s);
    assert.equal(data.items[0].id,'FIXTURE_ONLY');
    assert.equal(data.status,'connected');
    await run.finish();
    const [,cached]=await query('stac',s);
    assert.equal(cached.status,'cache');
    assert.equal(cached.fetched_at,data.fetched_at);
  }finally{globalThis.fetch=fetch;}
});

