const sessionCookie='__Host-ahv';
const visitorLifetime=30*86400000;
const safeHeaders={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
function response(body,status=200,extra={}){
  return new Response(body,{status,headers:{...safeHeaders,...extra}});
}
function json(body,status=200,extra={}){
  return response(JSON.stringify(body),status,{'Content-Type':'application/json; charset=utf-8',...extra});
}
function issueCookie(id){return sessionCookie+'='+id+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000';}
function visitor(request){
  const id=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-ahv=([a-f0-9]{32})(?:;|$)/)?.[1];
  return id?{id}:{id:identifier(),fresh:true};
}
function base64(text){
  const bytes=atob(text);
  return Uint8Array.from(bytes,c=>c.charCodeAt(0));
}
async function input(request){
  if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/json')return {error:'Envie JSON.',status:415};
  if(Number(request.headers.get('Content-Length'))>16384)return {error:'Solicitação muito grande.',status:413};
  try{
    const read=request.body.getReader();const decoder=new TextDecoder();let length=0,text='';
    for(;;){
      const {done,value}=await read.read();
      if(done)break;
      length+=value.length;
      if(length>16384){read.cancel().catch(()=>{});return {error:'Solicitação muito grande.',status:413};}
      text+=decoder.decode(value,{stream:true});
    }
    const data=JSON.parse(text+decoder.decode());
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();
    return {data};
  }catch{return {error:'Informe um objeto JSON.',status:400};}
}
async function readMission(db,id){
  const now=Date.now();
  let row=await db.prepare('SELECT revision,state,expires FROM visitor_mission WHERE visitor=?').bind(id).first();
  if(row&&row.expires>now)return row;
  const state=JSON.stringify(newMission());
  if(row){
    const result=await db.prepare('UPDATE visitor_mission SET revision=revision+1,state=?,expires=? WHERE visitor=? AND revision=?')
      .bind(state,now+visitorLifetime,id,row.revision).run();
    if(result.meta.changes)return {revision:row.revision+1,state,expires:now+visitorLifetime};
  }else{
    const result=await db.prepare('INSERT OR IGNORE INTO visitor_mission VALUES (?,0,?,?)').bind(id,state,now+visitorLifetime).run();
    if(result.meta.changes)return {revision:0,state,expires:now+visitorLifetime};
  }
  return db.prepare('SELECT revision,state,expires FROM visitor_mission WHERE visitor=?').bind(id).first();
}
async function saveMission(db,id,data){
  for(let i=0;i<4;i++){
    const row=await readMission(db,id);
    const mission=JSON.parse(row.state);
    let result;
    try{result=missionAction(mission,data);}catch(error){return {message:error.message,status:400,saved:false};}
    const next=JSON.stringify(mission);
    if(new TextEncoder().encode(next).length>1_350_000)return {message:'Limite de armazenamento deste navegador.',status:409,saved:false};
    const write=await db.prepare('UPDATE visitor_mission SET revision=revision+1,state=?,expires=? WHERE visitor=? AND revision=?')
      .bind(next,Date.now()+visitorLifetime,id,row.revision).run();
    if(write.meta.changes)return result;
  }
  return {message:'A sessão mudou em outra aba. Atualize a página e tente novamente.',status:409,saved:false};
}
function cleanExpired(env,ctx){
  if(Math.random()<0.01){
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare('DELETE FROM visitor_mission WHERE visitor IN (SELECT visitor FROM visitor_mission WHERE expires <= ? LIMIT 64)').bind(Date.now()),
      env.DB.prepare('DELETE FROM environment_cache WHERE selection IN (SELECT selection FROM environment_cache WHERE fetched < ? LIMIT 64)').bind(Date.now()-604800000),
    ]).catch(()=>{}));
  }
}
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url), path=url.pathname;
    const asset=Object.hasOwn(assets,path)?assets[path]:null;
    if(asset&&['HEAD','GET'].includes(request.method)){
      const [type,content]=asset, extra={'Content-Type':type};
      if(path==='/'){
        const v=visitor(request);
        if(v.fresh)extra['Set-Cookie']=issueCookie(v.id);
      }else extra['Cache-Control']='public, max-age=300';
      return response(request.method==='HEAD'?null:base64(content),200,extra);
    }
    if(request.method==='GET'&&path==='/api/environment/status')return json(envStatus(env));
    if(request.method==='POST'){
      const origin=request.headers.get('Origin'), site=request.headers.get('Sec-Fetch-Site');
      if((origin&&origin!==url.origin)||site==='cross-site')return json({error:'Origem inválida.'},403);
    }
    try{
      const match=path.match(/^\/api\/environment\/(stac|weather|kp|donki|preview)$/);
      if(request.method==='POST'&&match){
        const parsed=await input(request);if(!parsed.data)return json({error:parsed.error},parsed.status);
        const result=await environmentQuery(match[1],parsed.data,env,ctx);
        if(result.image)return response(result.image,200,{'Content-Type':result.type});
        const headers=result.retry_after?{'Retry-After':String(result.retry_after)}:{};
        return json(result,{invalid:400,rate_limit:429}[result.status]??200,headers);
      }
      if(request.method==='GET'&&['/api/state','/api/export'].includes(path)){
        const profile=url.searchParams.get('crew')||'A12',id=url.searchParams.get('session');
        if(!Object.hasOwn(crew,profile))return json({error:'Perfil fictício inválido.'},400);
        const v=visitor(request), row=await readMission(env.DB,v.id);
        const headers=v.fresh?{'Set-Cookie':issueCookie(v.id)}:{};
        let data;
        try{data=missionView(JSON.parse(row.state),profile,id);}
        catch(error){return json({error:error.message},400,headers);}
        if(path==='/api/export')headers['Content-Disposition']='attachment; filename="astrohealth-sintetico.json"';
        cleanExpired(env,ctx);
        return json(data,200,headers);
      }
      if(request.method==='POST'&&path==='/api/action'){
        const parsed=await input(request);if(!parsed.data)return json({error:parsed.error},parsed.status);
        const v=visitor(request),result=await saveMission(env.DB,v.id,parsed.data);
        return json(result,result.status,{'Set-Cookie':issueCookie(v.id)});
      }
      return json({error:'Página indisponível.'},404);
    }catch{
      return json({error:'Armazenamento ou serviço temporariamente indisponível.'},503);
    }
  },
};
