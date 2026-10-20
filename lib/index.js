import { readFile } from 'node:fs/promises';
import { dirname, delimiter } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as ReviewDock from 'dsh-review-dock';
import { connectSkillDiscovery } from './skill-discovery.js';
import { Manager } from './manager.js';

export const name='planners-form';
export const inject=['tools','skills'];
const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

export function createHandler(manager,{token=randomBytes(24).toString('hex'),reviewReady=()=>false}={}){
 return async request=>{
  try{
   const url=new URL(request.url);
   if(request.method==='GET')return reply(200,{...await manager.status(),token,reviewReady:reviewReady()});
   if(request.method!=='POST')return reply(405,{error:'不支持此请求'});
   if(request.headers.get('x-planners-token')!==token)return reply(403,{error:'请重新打开设置页后重试'});
   const site=request.headers.get('sec-fetch-site');if(site==='cross-site')return reply(403,{error:'拒绝跨站请求'});
   const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==(request.headers.get('host')||url.host))return reply(403,{error:'请求来源不匹配'});
   if(!request.headers.get('content-type')?.startsWith('application/json'))return reply(415,{error:'需要 JSON 请求'});
   const text=await request.text();if(text.length>16384)return reply(413,{error:'请求过大'});
   const body=JSON.parse(text);
   if(body.action==='check')return reply(200,{...await manager.checkUpdates(body.force===true),token,reviewReady:reviewReady()});
   if(body.action==='diagnose')return reply(200,await manager.diagnostics({kind:body.kind==='update'?'update':'fix',reviewReady:reviewReady()}));
   return reply(202,{job:manager.start(body.action,body.ids)});
  }catch(e){return reply(400,{error:e.message});}
 };
}

export function apply(ctx){
 let dockMounted=false;
 const ensureReview=async()=>{if(!dockMounted&&!ctx.tools.get('review_open')){ctx.plugin(ReviewDock,{reviewCoreDir:await manager.location('planners-review-core',await manager.detectedSkills())});dockMounted=true;}};
 const original={PATH:process.env.PATH,PLANNERS_REVIEW_PYTHON:process.env.PLANNERS_REVIEW_PYTHON};let managedPath;
 const manager=new Manager({catalog,onEnvironment:async env=>{
  await ensureReview();
  if(env.pythonReady){managedPath=dirname(env.python)+delimiter+(original.PATH||'');process.env.PATH=managedPath;process.env.PLANNERS_REVIEW_PYTHON=env.python;}
 }});
 ctx.effect(()=>()=>{if(process.env.PATH===managedPath)process.env.PATH=original.PATH;if(process.env.PLANNERS_REVIEW_PYTHON?.startsWith(manager.root)){if(original.PLANNERS_REVIEW_PYTHON)process.env.PLANNERS_REVIEW_PYTHON=original.PLANNERS_REVIEW_PYTHON;else delete process.env.PLANNERS_REVIEW_PYTHON;}});
 // Reuse an existing Dock. On a clean host, the pinned dependency supplies it.
 // Core must exist before Dock resolves and caches its bridge.
 connectSkillDiscovery(ctx,manager);
 // Host-side plugin management is the only supported way to update a profile
 // dependency in place: it owns the pnpm call, the profile lock, the manifest
 // backup and the HMR re-composition. Absent (older hosts, other shells), the
 // settings page falls back to a copyable update prompt for the user's agent.
 ctx.inject(['pluginManager'],child=>{manager.hostPluginManager=child.pluginManager;});
 const handler=createHandler(manager,{reviewReady:()=>Boolean(ctx.tools.get('review_open'))});
 ctx.inject(['connection'],child=>child.effect(()=>child.connection.fetch.register({path:'/api/planners-form',methods:['GET','POST'],requestBody:'buffered',fetch:handler})));
 // Installing Form prepares its base module; user skills remain opt-in.
 
 manager.status().then(status=>{const core=status.packages.find(p=>p.id==='planners-review-core');if(core.ownership==='absent'||core.ownership==='missing')manager.start('install',['planners-review-core']);else return manager.environment().then(env=>manager.onEnvironment(env));}).catch(e=>ctx.logger?.warn?.(e.message));
}
