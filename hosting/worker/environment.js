const pc='https://planetarycomputer.microsoft.com';
const nasa='https://ccmc.gsfc.nasa.gov';
const collections={
  'landsat-c2-l2':['Landsat Collection 2 Level-2','NASA e USGS · processamento USGS','https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products'],
  'modis-09A1-061':['MODIS Surface Reflectance 8-Day (500 m)','NASA LP DAAC no USGS EROS','https://www.earthdata.nasa.gov/data/catalog/lpcloud-mod09a1-061'],
};
const weatherParams={'t_2m:C':['Temperatura do ar','°C'],'relative_humidity_2m:p':['Umidade relativa','%'],
  'msl_pressure:hPa':['Pressão ao nível do mar','hPa'],'wind_speed_10m:ms':['Velocidade do vento a 10 m','m/s'],
  'wind_dir_10m:d':['Direção do vento a 10 m','°'],'precip_1h:mm':['Precipitação em 1 h','mm'],'total_cloud_cover:p':['Cobertura de nuvens','%']};
const kpParams={'kp:idx':['Índice planetário Kp','índice 0–9']};
const donkiEvents={FLR:'Erupção solar',GST:'Tempestade geomagnética',CME:'Ejeção de massa coronal'};
const providerNames={stac:'Microsoft Planetary Computer / STAC',preview:'Microsoft Planetary Computer / miniatura',
  weather:'Meteomatics · clima terrestre', kp:'Meteomatics · índice Kp da NOAA',donki:'NASA DONKI'};
const envMessages={untested:'Teste real não executado nesta sessão.',cache:'Resultado anterior em cache.',
  connected:'Conectado e consulta bem-sucedida.',empty:'Sem dados para a seleção.',invalid:'Seleção inválida.',
  offline:'Sem conexão com o serviço. Dados externos indisponíveis.',denied:'Credenciais inválidas ou acesso negado pelo serviço.',
  malformed:'O serviço devolveu dados em formato inesperado.',service_error:'Erro do serviço. Dados externos indisponíveis.',
  expired:'Acesso temporário expirado. Consulte novamente a origem.',rate_limit:'Limite de uso ou pausa entre consultas.',
  unconfigured:'Meteomatics não configurada.',coverage:'O ponto está fora da área regional aproximada do EURO1k.'};
const latestEnvironment=new Map();
const itemId=value=>typeof value==='string'&&/^[a-z0-9_][a-z0-9_.-]{0,179}$/i.test(value);
const clean=(value,size=220)=>typeof value==='string'?value.trim().slice(0,size)||null:null;
const num=value=>Number.isFinite(value)?value:null;
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
function envFault(code,message=null,retry_after=null){return {envFault:code,message,retry_after};}
function envResult(source,status,extra={}){
  return {source,name:providerNames[source],status,message:envMessages[status],checked_at:null,...extra};
}
function envStatus(env){
  const hasMeteo=Boolean(env.METEOMATICS_USERNAME&&env.METEOMATICS_PASSWORD);
  return {nasa_route:'ccmc',landsat_cache:true,services:Object.fromEntries(Object.keys(providerNames).map(kind=>
    [kind,!hasMeteo&&['weather','kp'].includes(kind)?envResult(kind,'unconfigured'):latestEnvironment.get(kind)??envResult(kind,'untested')]))};
}
function coordinates(value,max){
  const n=typeof value==='string'&&value.trim()?Number(value):value;
  if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>max)throw envFault('invalid','Informe coordenadas válidas.');
  return Number(n.toFixed(5));
}
function interval(raw,max){
  const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&validDate(v)?.slice(0,10)===v;
  const {start,end}=raw;
  if(!date(start)||!date(end)||start>end||end>stamp().slice(0,10)||(Date.parse(end)-Date.parse(start))/86400000>=max)
    throw envFault('invalid','Informe datas válidas, em ordem, em um intervalo de até '+max+' dias.');
  return {start,end};
}
async function pull(url,options={},mode='json'){
  let response;
  try{response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(8500)});}
  catch{throw envFault('offline');}
  if(response.status===429){
    const delay=Number.parseInt(response.headers.get('Retry-After'),10);
    throw envFault('rate_limit',null,Number.isFinite(delay)?Math.max(10,Math.min(86400,delay)):60);
  }
  if([401,403].includes(response.status))throw envFault('denied');
  if(response.status===410)throw envFault('expired');
  if(!response.ok)throw envFault('service_error','O serviço respondeu com HTTP '+response.status+'.');
  if(response.status===204&&mode==='json')return [];
  const type=(response.headers.get('Content-Type')||'').split(';')[0];
  const max=2_000_000, reader=response.body?.getReader();
  if(!reader)throw envFault('malformed');
  const chunks=[];let length=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.length;
      if(length>max){reader.cancel().catch(()=>{});throw envFault('malformed','A resposta ultrapassou o limite de tamanho.');}
      chunks.push(value);
    }
  }catch(error){if(error?.envFault)throw error;throw envFault('offline');}
  const bytes=new Uint8Array(length);let start=0;
  for(const chunk of chunks){bytes.set(chunk,start);start+=chunk.length;}
  if(mode==='image'){
    if(!((type==='image/png'&&bytes[0]===137&&bytes[1]===80)||(type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216))) throw envFault('malformed');
    return {image:bytes,type};
  }
  if(!/^application\/(?:[\w.-]+\+)?json$/i.test(type))throw envFault('malformed');
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw envFault('malformed');}
}
function previewHref(item,collection){
  try{
    const u=new URL(item.assets?.rendered_preview?.href);
    return u.origin===pc&&/^\/api\/data\/v1\/item\/preview\.(png|jpg|jpeg)$/.test(u.pathname)&&
      u.searchParams.get('collection')===collection&&u.searchParams.get('item')===item.id?u.href:null;
  }catch{return null;}
}
function stacSelection(raw){
  if(!Object.hasOwn(collections,raw.collection)||!Array.isArray(raw.bbox)||raw.bbox.length!==4)throw envFault('invalid');
  const bbox=raw.bbox.map((v,i)=>coordinates(v,i%2?90:180));const [w,s,e,n]=bbox;
  if(!(w<e&&s<n)||e-w>30||n-s>30)throw envFault('invalid','Use oeste < leste e sul < norte, com até 30° por 30°.');
  return {collection:raw.collection,bbox,...interval(raw,93)};
}
async function stacSearch(s){
  const params=new URLSearchParams({collections:s.collection,bbox:s.bbox.join(','),datetime:s.start+'T00:00:00Z/'+s.end+'T23:59:59.999Z',limit:'8'});
  const raw=await pull(pc+'/api/stac/v1/search?'+params);
  if(raw?.type!=='FeatureCollection'||!Array.isArray(raw.features))throw envFault('malformed');
  const items=raw.features.slice(0,8).map(item=>{
    if(!item||item.collection!==s.collection||!itemId(item.id)||!item.properties)throw envFault('malformed');
    const p=item.properties;
    return {id:item.id,acquired_at:validDate(p.datetime),start_at:validDate(p.start_datetime),end_at:validDate(p.end_datetime),
      bbox:Array.isArray(item.bbox)&&item.bbox.every(Number.isFinite)?item.bbox:null,platform:clean(p.platform),
      instruments:Array.isArray(p.instruments)?p.instruments.slice(0,8).map(x=>clean(x,50)).filter(Boolean).join(' · ')||null:null,
      resolution_m:num(p.gsd),cloud_percent:num(p['eo:cloud_cover']),processing:clean(p['landsat:correction']??p['processing:level']),
      product:clean(p['landsat:scene_id']??p['modis:product']),preview:Boolean(previewHref(item,s.collection)),
      link:pc+'/api/stac/v1/collections/'+s.collection+'/items/'+item.id};
  });
  const [collection_name,attribution,documentation]=collections[s.collection];
  return {items,more:Array.isArray(raw.links)&&raw.links.some(x=>x?.rel==='next'),
    collection_name,attribution,documentation,catalogue:pc+'/dataset/'+s.collection,platform:'Microsoft Planetary Computer · STAC',
    nominal_resolution_m:s.collection==='modis-09A1-061'?500:null};
}
async function getPreview(s){
  const record=await pull(pc+'/api/stac/v1/collections/'+s.collection+'/items/'+s.item);
  if(record?.collection!==s.collection||record?.id!==s.item)throw envFault('malformed');
  const href=previewHref(record,s.collection);
  if(!href)throw envFault('empty','A origem não informou miniatura compatível.');
  return pull(href,{},'image');
}
function forecastSelection(raw){
  const lat=coordinates(raw.lat,90),lon=coordinates(raw.lon,180);
  if(!['mix','mm-euro1k'].includes(raw.model)||!['0','6','24'].includes(raw.horizon))throw envFault('invalid');
  if(raw.model==='mm-euro1k'&&!(lat>=24&&lat<=73&&lon>=-32&&lon<=50))throw envFault('coverage');
  return {lat,lon,model:raw.model,horizon:Number(raw.horizon)};
}
async function forecast(kind,s,env){
  const space=kind==='kp',params=space?kpParams:weatherParams;
  const requested=new Date();const now=requested.getTime();
  if(space)requested.setUTCHours(requested.getUTCHours()-requested.getUTCHours()%3,0,0,0);
  else requested.setUTCMinutes(requested.getUTCMinutes()-requested.getUTCMinutes()%15+s.horizon*60,0,0);
  const requested_at=requested.toISOString().replace('.000Z','Z');
  const model=space?'noaa-swpc':s.model;
  const coords=space?'0.00,0.00':s.lat+','+s.lon;
  const key=Uint8Array.from(new TextEncoder().encode(env.METEOMATICS_USERNAME+':'+env.METEOMATICS_PASSWORD));
  const auth='Basic '+btoa(String.fromCharCode(...key));
  const raw=await pull('https://api.meteomatics.com/'+requested_at+'/'+Object.keys(params).join(',')+'/'+coords+'/json?source='+model,{headers:{Authorization:auth}});
  if(raw?.status!=='OK'||!Array.isArray(raw.data))throw envFault('malformed');
  const reported_model=clean(raw.model??raw.source,80);
  if(model==='mm-euro1k'&&reported_model&&!['mm-euro1k','euro1k'].includes(reported_model.toLowerCase()))throw envFault('service_error','A origem informou outro modelo.');
  const items=[];
  for(const sample of raw.data){
    if(!Object.hasOwn(params,sample?.parameter))continue;
    const point=sample.coordinates?.[0]?.dates?.[0];
    if(!point||num(point.value)===null||point.value===-999)continue;
    const valid_at=validDate(point.date);
    if(!valid_at||(space&&(point.value<0||point.value>9)))throw envFault('malformed');
    const [label,unit]=params[sample.parameter];const age=now-Date.parse(valid_at);
    const kindName={observation:'Observação',observed:'Observação',forecast:'Previsão',analysis:'Análise'}[String(point.dataType??raw.dataType).toLowerCase()]??null;
    items.push({parameter:sample.parameter,label,unit,value:point.value,valid_at,kind:model==='mm-euro1k'?'Previsão de modelo regional':kindName,
      update:age<0?'Validade futura':age>(space?4:1)*3600000?'Valor anterior · desatualizado':'Dentro da janela de validade usada pelo painel'});
  }
  return {items,requested_at,requested_model:model,reported_model,generated_at:validDate(raw.dateGenerated),
    initialized_at:validDate(raw.dateInitialized??raw.initDate),missing:Object.entries(params).filter(([key])=>!items.some(i=>i.parameter===key)).map(([,v])=>v[0]),
    attribution:space?'NOAA Space Weather Prediction Center':model==='mm-euro1k'?'EURO1k · Meteomatics':'Meteomatics Mix',platform:'Meteomatics Weather API'};
}
async function nasaEvents(s){
  const query=new URLSearchParams({startDate:s.start,endDate:s.end});
  const raw=await pull(nasa+'/DONKI-API/get/'+s.event+'?'+query);
  if(!Array.isArray(raw))throw envFault('malformed');
  const items=raw.map(row=>{
    const id=clean(row?.flrID??row?.gstID??row?.activityID,100),at=validDate(row?.beginTime??row?.startTime);
    if(!id||!at)throw envFault('malformed');
    let link=nasa+'/DONKI/events/';
    try{
      const url=new URL(row.link);
      if(['ccmc.gsfc.nasa.gov','kauai.ccmc.gsfc.nasa.gov'].includes(url.hostname)&&url.pathname.startsWith('/DONKI/'))link=nasa+url.pathname;
    }catch{}
    const geomagnetic=Array.isArray(row.allKpIndex)?row.allKpIndex.slice(0,24).filter(p=>num(p?.kpIndex)!==null&&p.kpIndex>=0&&p.kpIndex<=9&&validDate(p.observedTime))
      .map(p=>({value:p.kpIndex,valid_at:validDate(p.observedTime),source:clean(p.source)})):[];
    return {id,at,link,type:donkiEvents[s.event],class_type:clean(row.classType),region:clean(row.sourceLocation),
      note:clean(row.note,500),peak_at:validDate(row.peakTime),ended_at:validDate(row.endTime),submitted_at:validDate(row.submissionTime),geomagnetic};
  }).sort((a,b)=>b.at.localeCompare(a.at));
  return {items:items.slice(0,30),more:items.length>30,attribution:'NASA DONKI · Community Coordinated Modeling Center',platform:'NASA CCMC · serviço público'};
}
async function acquireQuota(db,key){
  const now=Date.now();
  const result=await db.prepare('INSERT INTO external_quota VALUES (?, ?) ON CONFLICT(operation) DO UPDATE SET available_at=excluded.available_at WHERE available_at <= ?')
    .bind(key,now+4000,now).run();
  if(!result.meta.changes) {
    const ready=await db.prepare('SELECT available_at FROM external_quota WHERE operation=?').bind(key).first();
    throw envFault('rate_limit',null,Math.max(1,Math.ceil((ready.available_at-now)/1000)));
  }
}
async function environmentQuery(kind,raw,env,ctx){
  let s={}, cached=null, key=null;
  const db=env.DB,quotaKey=kind==='kp'||kind==='weather'?'meteomatics':kind;
  const cacheResult=extra=>envResult(kind,'cache',{...cached.result,status:'cache',message:envMessages.cache,
    checked_at:null,age_seconds:cached.age,cache_fresh:cached.age<=21600,...extra});
  const mark=result=>{
    latestEnvironment.set(kind,{source:kind,name:providerNames[kind],status:result.status,message:result.message,checked_at:result.checked_at,
      ...(result.upstream_status?{upstream_status:result.upstream_status}:{})});
    return result;
  };
  let tried=false;
  try{
    if(kind==='stac')s=stacSelection(raw);
    if(kind==='preview'){
      if(!Object.hasOwn(collections,raw.collection)||!itemId(raw.item))throw envFault('invalid');
      s={collection:raw.collection,item:raw.item};
    }
    if(kind==='weather')s=forecastSelection(raw);
    if(kind==='donki'){
      if(!Object.hasOwn(donkiEvents,raw.event))throw envFault('invalid');
      s={event:raw.event,...interval(raw,31)};
    }
    if(['weather','kp'].includes(kind)&&!(env.METEOMATICS_USERNAME&&env.METEOMATICS_PASSWORD))return mark(envResult(kind,'unconfigured'));
    if(kind==='stac'&&s.collection==='landsat-c2-l2'){
      key=JSON.stringify(s);
      const row=await db.prepare('SELECT result,fetched FROM environment_cache WHERE selection=? AND fetched>?').bind(key,Date.now()-604800000).first();
      if(row)cached={result:JSON.parse(row.result),age:Math.max(0,Math.floor((Date.now()-row.fetched)/1000))};
      if(cached&&cached.age<=21600&&raw.refresh!==true)return mark(cacheResult({}));
    }
    await acquireQuota(db,quotaKey);tried=true;
    if(kind==='preview'){
      const result=await getPreview(s);mark(envResult(kind,'connected',{checked_at:stamp()}));return result;
    }
    const payload=await (kind==='stac'?stacSearch(s):kind==='donki'?nasaEvents(s):forecast(kind,s,env));
    const at=stamp();
    const result=envResult(kind,payload.items.length?'connected':'empty',
      {checked_at:at,fetched_at:at,classification:'external',selection:s,...payload});
    if(key){
      const persist=payload.items.length?
        db.prepare('INSERT OR REPLACE INTO environment_cache VALUES (?, ?, ?)').bind(key,JSON.stringify(result),Date.now()).run():
        db.prepare('DELETE FROM environment_cache WHERE selection=?').bind(key).run();
      ctx.waitUntil(persist.catch(()=>{}));
    }
    return mark(result);
  }catch(error){
    const status=error?.envFault??'service_error', retry_after=error?.retry_after??null;
    if(tried&&status==='rate_limit'&&retry_after) await db.prepare('UPDATE external_quota SET available_at=? WHERE operation=?').bind(Date.now()+retry_after*1000,quotaKey).run();
    const checked_at=tried?stamp():null;
    if(cached&&['offline','malformed','rate_limit','service_error'].includes(status))
      return mark(cacheResult({checked_at,upstream_status:status,upstream_message:error?.message||envMessages[status],retry_after}));
    return mark(envResult(kind,status,{message:error?.envFault&&error.message?error.message:envMessages[status],
      checked_at,retry_after,classification:'unavailable',selection:s}));
  }
}

