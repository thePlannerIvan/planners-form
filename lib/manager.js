import { mkdir, readdir, readFile, writeFile, rename, rm, lstat, readlink, symlink, open, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as tar from 'tar';
import { compareVersions, resolveCommit as defaultResolveCommit, resolveRelease as defaultResolveRelease } from './upstream.js';
import { buildSnapshot, renderFixPrompt, renderUpdatePrompt } from './diagnostics.js';
const exec = promisify(execFile);
const sha = /^[a-f0-9]{40}$/;
const exists = async p => { try { await lstat(p); return true; } catch (e) { if(e.code==='ENOENT') return false; throw e; } };
const json = async (p, fallback) => { try { return JSON.parse(await readFile(p,'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } };
const atomic = async (p,v) => { const tmp=p+'.'+randomUUID(); await writeFile(tmp,JSON.stringify(v,null,2)+'\n',{mode:0o600}); await rename(tmp,p); };
const CHECK_TTL_MS = 10 * 60 * 1000;
const PLUGIN_TTL_MS = 10 * 60 * 1000;
const ENVIRONMENT_TTL_MS = 15 * 1000;
const RESOLVE_CONCURRENCY = 4;
const PLUGIN_REPOSITORY = 'thePlannerIvan/planners-form';
const PLUGIN_CHANNEL = 'main';

async function mapLimit(items, limit, worker) {
 const queue=[...items]; const runners=[];
 const take=async()=>{ while(queue.length){ const item=queue.shift(); await worker(item); } };
 for(let i=0;i<Math.min(limit,queue.length);i++)runners.push(take());
 await Promise.all(runners);
}

/**
 * Derive the DSH profile from this package's own installed path.
 *
 * The plugin process does not inherit DSH_PROFILE/DSH_PROFILE_DIR (they are
 * set for tool shells, not for the host process), so the profile has to be read
 * back from where the package sits: `<profiles>/<name>/node_modules/...` or
 * `<profiles>/<name>/node_modules/.pnpm/...`. This keeps the settings page and
 * the diagnostic prompt from reporting "profile: unknown".
 */
export function profileFromInstallFile(file) {
 const parts=String(file).split(sep);
 const index=parts.lastIndexOf('profiles');
 if(index===-1 || parts.length<=index+2)return null;
 return {profile:parts[index+1],profileDir:parts.slice(0,index+2).join(sep)};
}

/** Last-resort profile lookup for installs outside a profile directory. */
async function profileInHome(home) {
 const dir=join(home,'profiles');let names;
 try{ names=await readdir(dir); }catch{ return null; }
 for(const name of names){
  const profileDir=join(dir,name);
  try{
   const manifest=JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));
   if(manifest?.dependencies?.['planners-form'])return {profile:name,profileDir};
  }catch{}
 }
 return null;
}

export function closure(catalog, ids) {
 const byId=new Map(catalog.packages.map(p=>[p.id,p])), seen=new Set(), active=new Set(), result=[];
 function visit(id) { const p=byId.get(id); if(!p || !p.available) throw new Error(`暂不可安装：${id}`); if(active.has(id)) throw new Error('依赖清单存在循环'); if(seen.has(id))return; active.add(id); for(const dep of p.dependencies)visit(dep); active.delete(id); seen.add(id); result.push(p); }
 for(const id of ids)visit(id); return result;
}

export async function downloadPackage(pkg, dest, fetcher=fetch) {
 if(!/^thePlannerIvan\/[A-Za-z0-9_-]+$/.test(pkg.repository)||!sha.test(pkg.revision))throw new Error('无效的发布来源或版本');
 const response=await fetcher(`https://codeload.github.com/${pkg.repository}/tar.gz/${pkg.revision}`,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error(`下载 ${pkg.title}（${pkg.repository}@${pkg.revision.slice(0,8)}）失败（${response.status}）`);
 const archive=dest+'.tgz'; let size=0; const handle=await open(archive,'wx',0o600);
 try { for await(const chunk of response.body) { size+=chunk.length; if(size>100*1024*1024)throw new Error('安装包超过 100 MB'); await handle.write(chunk); } } catch(e) { await handle.close();await rm(archive,{force:true});throw e; } finally { await handle.close().catch(()=>{}); }
 await mkdir(dest,{recursive:true});
 try {
  let unpacked=0, invalid=null;
  await tar.t({file:archive, onReadEntry:e=>{
   unpacked+=e.size;
   if(unpacked>400*1024*1024 || !['File','Directory','ExtendedHeader','GlobalExtendedHeader'].includes(e.type) || e.path.split('/').includes('..') || e.path.startsWith('/')) invalid='安装包包含不支持的文件或路径';
  }});
  if(invalid)throw new Error(invalid);
  await tar.x({file:archive,cwd:dest,strip:1,strict:true,preservePaths:false,noChmod:true,filter:p=>!p.split('/').some(s=>s==='.git'||s==='.env'||s==='.venv'||s==='node_modules'||/\.(pem|key)$/.test(s))});
 } finally { await rm(archive,{force:true}); }
 const skill=await readFile(join(dest,'SKILL.md'),'utf8');
 if(!skill.startsWith('---') || !new RegExp(`^name:\\s*["']?${pkg.id}["']?\\s*$`,'m').test(skill))throw new Error(`Skill 标识不匹配：${pkg.id}（${pkg.repository}@${pkg.revision.slice(0,8)}）`);
}

export class Manager {
 constructor({catalog,home=process.env.DSH_HOME?.trim()||join(homedir(),'.dsh'),download=downloadPackage,run=exec,fetcher=fetch,onEnvironment=()=>{},discover=null,invalidateSkills=()=>{},resolveCommit=defaultResolveCommit,resolveRelease=defaultResolveRelease,now=Date.now,packageFile=fileURLToPath(new URL('../package.json',import.meta.url))}={}) {
  this.discover=discover; this.invalidateSkills=invalidateSkills; this.catalog=catalog; this.home=resolve(home); this.root=join(this.home,'planners-form'); this.skills=join(this.root,'skills'); this.mounts=join(this.home,'skills'); this.stateFile=join(this.root,'state.json'); this.staging=join(this.root,'staging'); this.download=download; this.run=run; this.fetcher=fetcher; this.onEnvironment=onEnvironment; this.packageFile=packageFile;
  this.resolveCommit=resolveCommit; this.resolveRelease=resolveRelease; this.now=now;
  this.job=null; this.updates={}; this.checkErrors={}; this.checkedAt=null; this.checkError=null; this.checkFlight=null;
  this.environmentCache=null; this.pluginCache=null; this.pluginCheckedAt=null; this.pluginFlight=null; this.lastPythonError=null;
  this.hostPluginManager=null; this.packageInfo=null;
 }
 async state() { return json(this.stateFile,{schema:1,installed:{}}); }
 async detectedSkills() { return this.discover ? await this.discover() : []; }
 async location(id, discovered=[]) {
  const skill=discovered.find(s=>s.name===id);
  if(skill?.resourceBase?.kind==='directory')return skill.resourceBase.path;
  if(skill?.path)return dirname(skill.path);
  return join(this.mounts,id);
 }
 async ownership(id,state,discovered) {
  discovered ??= await this.detectedSkills();
  const mount=await this.location(id,discovered), target=join(this.skills,id);
  if(!await exists(mount))return state.installed[id]?'missing':'absent';
  const valid=existsSync(join(mount,'SKILL.md'))&&(!this.discover||discovered.some(s=>s.name===id));
  if(state.installed[id]) {
   try { if(await realpath(mount)===await realpath(target))return valid?'managed':'missing'; } catch(e) { if(e.code!=='ENOENT')throw e; }
  }
  // A conflicting directory is not an installed skill and must not be overwritten.
  return valid?'external':(state.installed[id]?'missing':'absent');
 }
 async environment() {
  const cached=this.environmentCache;
  if(cached && this.now()-cached.at<ENVIRONMENT_TTL_MS)return cached.value;
  const python=join(this.root,'python',process.platform==='win32'?'Scripts/python.exe':'bin/python3');
  let pythonReady=false;
  if(existsSync(python))try{await this.run(python,['-c','import pptx,lxml,PIL,os; from playwright.sync_api import sync_playwright; p=sync_playwright().start(); assert os.path.isfile(p.chromium.executable_path); p.stop()'],{timeout:10000});pythonReady=true;}catch(error){this.lastPythonError=String(error?.stderr||error?.message||error);}
  const value={node:process.versions.node,nodeReady:Number(process.versions.node.split('.')[0])>=20,pythonReady,python:pythonReady?python:null};
  this.environmentCache={at:this.now(),value};
  return value;
 }
 async ownPackage() {
  this.packageInfo ??= JSON.parse(await readFile(this.packageFile,'utf8'));
  return this.packageInfo;
 }
 async profileState() {
  let profile=process.env.DSH_PROFILE?.trim()||null;
  let profileDir=process.env.DSH_PROFILE_DIR?.trim()||null;
  if(profileDir===null){
   const derived=profileFromInstallFile(this.packageFile)??await profileInHome(this.home);
   if(derived!==null){profile=derived.profile;profileDir=derived.profileDir;}
  }
  const result={profile,profileDir,spec:null,commit:null};
  if(profileDir===null)return result;
  try{ const manifest=JSON.parse(await readFile(join(profileDir,'package.json'),'utf8')); result.spec=manifest?.dependencies?.['planners-form']??null; }catch{}
  try{ const lock=await readFile(join(profileDir,'pnpm-lock.yaml'),'utf8'); const found=/planners-form@[^\n]*?tar\.gz\/([a-f0-9]{40})/.exec(lock)??/codeload\.github\.com\/thePlannerIvan\/planners-form\/tar\.gz\/([a-f0-9]{40})/.exec(lock); result.commit=found?.[1]??null; }catch{}
  if(result.commit===null && typeof result.spec==='string'){ const match=/#([a-f0-9]{40})$/.exec(result.spec); if(match)result.commit=match[1]; }
  return result;
 }
 async pluginInfoBase() {
  const own=await this.ownPackage(); const profile=await this.profileState();
  const spec=profile.spec;
  const mode=spec===null||spec===undefined?'unknown':spec.startsWith('github:')?'github':spec.startsWith('link:')?'link':spec.startsWith('file:')?'file':'other';
  return {
   version:own.version, commit:profile.commit, spec, mode,
   profile:profile.profile, profileDir:profile.profileDir,
   canSelfUpdate:Boolean(this.hostPluginManager)&&mode==='github',
   latestVersion:null, latestCommit:null, updateAvailable:false, ahead:false, error:null,
  };
 }
 async checkPlugin(force=false) {
  if(!force && this.pluginCache && this.pluginCheckedAt!==null && this.now()-this.pluginCheckedAt<PLUGIN_TTL_MS)return this.pluginCache;
  if(this.pluginFlight)return this.pluginFlight;
  this.pluginFlight=(async()=>{
   const info=await this.pluginInfoBase(); const errors=[];
   try{ info.latestVersion=(await this.resolveRelease(PLUGIN_REPOSITORY,{fetcher:this.fetcher})).version; }catch(e){ errors.push(`版本：${e.message}`); }
   try{ info.latestCommit=await this.resolveCommit(PLUGIN_REPOSITORY,PLUGIN_CHANNEL,{fetcher:this.fetcher}); }catch(e){ errors.push(`提交：${e.message}`); }
   info.error=errors.length?errors.join('；'):null;
   const order=info.latestVersion===null?null:compareVersions(info.latestVersion,info.version);
   info.ahead=order!==null&&order<0;
   if(info.latestCommit!==null && info.commit!==null) info.updateAvailable=info.latestCommit!==info.commit;
   else if(order!==null) info.updateAvailable=order>0;
   this.pluginCache=info; this.pluginCheckedAt=this.now();
   return info;
  })().finally(()=>{this.pluginFlight=null;});
  return this.pluginFlight;
 }
 async status() {
  const state=await this.state(),discovered=await this.detectedSkills();
  const packages=await Promise.all(this.catalog.packages.map(async p=>{ const ownership=await this.ownership(p.id,state,discovered); const installed=state.installed[p.id]; return {...p,ownership,installedPath:['managed','external'].includes(ownership)?await this.location(p.id,discovered):null,installedRevision:installed?.revision||null,update:ownership==='managed'&&this.updates[p.id]&&this.updates[p.id]!==installed?.revision?this.updates[p.id]:null,checkError:this.checkErrors[p.id]||null}; }));
  const plugin=this.pluginCache??await this.pluginInfoBase();
  return {packages,job:this.job,checkedAt:this.checkedAt,checkError:this.checkError,environment:await this.environment(),plugin,lastSelfUpdate:state.lastSelfUpdate??null,root:this.root};
 }
 async checkUpdates(force=true) {
  if(this.checkFlight)return this.checkFlight;
  this.checkFlight=this.performCheck(force);
  try{return await this.checkFlight;}finally{this.checkFlight=null;}
 }
 async performCheck(force) {
  if(!force && this.checkedAt && this.now()-Date.parse(this.checkedAt)<CHECK_TTL_MS)return this.status();
  const state=await this.state();
  const ids=Object.keys(state.installed);
  const updates={},checkErrors={};
  await mapLimit(ids,RESOLVE_CONCURRENCY,async id=>{
   const pkg=this.catalog.packages.find(p=>p.id===id);
   if(pkg===undefined){checkErrors[id]='目录中已没有该 Skill';return;}
   try{ updates[id]=await this.resolveCommit(pkg.repository,pkg.channel||'main',{fetcher:this.fetcher}); }
   catch(e){ checkErrors[id]=e.message; }
  });
  this.updates=updates; this.checkErrors=checkErrors;
  await this.checkPlugin(true);
  const failures=Object.keys(checkErrors);
  this.checkError=failures.length?`${failures.length} 项未能检查：${failures.slice(0,3).map(id=>`${id}（${checkErrors[id]}）`).join('；')}`:null;
  this.checkedAt=new Date().toISOString();
  return this.status();
 }
 start(action, ids=[]) {
  if(this.job?.state==='running')throw new Error('已有操作正在进行');
  if(!['install','update','repair','update-all','self-update'].includes(action))throw new Error('未知操作');
  if(!Array.isArray(ids)||ids.some(x=>typeof x!=='string')||ids.length>30)throw new Error('无效的 Skill 列表');
  if(action==='install'||action==='update') {if(!ids.length)throw new Error('请选择 Skill');closure(this.catalog,ids);}
  this.job={id:randomUUID(),state:'running',message:'准备安装',startedAt:new Date().toISOString(),log:[]};
  const work=action==='self-update'?this.selfUpdate():this.transaction(action,ids);
  this.running=work.then(()=>{this.job.state='done';this.job.message=this.job.message||'本次操作已完成';},error=>{this.job.state='error';this.job.message=error.message;}).finally(()=>{this.job.finishedAt=new Date().toISOString();});
  return this.job;
 }
 log(message){this.job.message=message;this.job.log.push(message);if(this.job.log.length>60)this.job.log.shift();}
 async lock(){
  await mkdir(this.root,{recursive:true});const path=join(this.root,'install.lock');
  try{const f=await open(path,'wx',0o600);await f.writeFile(JSON.stringify({pid:process.pid}));await f.close();return ()=>rm(path,{force:true});}
  catch(e){if(e.code!=='EEXIST')throw e;const prior=await json(path,{});if(Number.isInteger(prior.pid))try{process.kill(prior.pid,0);}catch(err){if(err.code==='ESRCH'){await rm(path);return this.lock();}}throw new Error('另一个安装进程正在工作；请稍后重试');}
 }
 async rollback(journal) {
  for(const item of [...journal.items].reverse()) {
   const mount=join(this.mounts,item.id),target=join(this.skills,item.id),backup=join(journal.dir,'backup',item.id);
   if(await exists(backup)){await rm(target,{recursive:true,force:true});await rename(backup,target);}
   else if(!item.hadTarget)await rm(target,{recursive:true,force:true});
   if(!item.hadMount&&await exists(mount)) {const stat=await lstat(mount);if(stat.isSymbolicLink()&&resolve(dirname(mount),await readlink(mount))===target)await rm(mount);}
  }
  await atomic(this.stateFile,journal.state);await rm(join(this.root,'journal.json'),{force:true});await rm(journal.dir,{recursive:true,force:true});
 }
 /** Decide what each package in the plan should install, resolving `main` on demand. */
 async plan(action,plan,state,requested) {
  const decisions=[],skipped=[];
  for(const base of plan){
   const owner=await this.ownership(base.id,state);
   if(owner==='external'){
    const external=await this.location(base.id,await this.detectedSkills());
    if(!await exists(join(external,'SKILL.md')))throw new Error(`已有安装损坏，请自行修复：${base.title}`);
    const alias=join(this.skills,base.id);if(!await exists(alias))await symlink(external,alias,process.platform==='win32'?'junction':'dir');
    this.log(`沿用已有安装：${base.title}`);continue;
   }
   const installed=state.installed[base.id];
   if(action==='install'&&installed!==undefined)continue;
   const target=join(this.skills,base.id),mount=join(this.mounts,base.id);
   if(await exists(mount)&&!(installed&&(await lstat(mount)).isSymbolicLink()&&resolve(dirname(mount),await readlink(mount))===target))throw new Error(`安装位置已被占用，请先检查：${mount}`);
   if(await exists(target)&&!installed)throw new Error(`检测到未登记目录，不覆盖：${base.title}`);
   let revision=null;
   if(action==='repair'&&installed?.revision)revision=installed.revision;
   decisions.push({base,installed,revision});
  }
  await mapLimit(decisions.filter(d=>d.revision===null),RESOLVE_CONCURRENCY,async decision=>{
   try{ decision.revision=await this.resolveCommit(decision.base.repository,decision.base.channel||'main',{fetcher:this.fetcher}); }
   catch(error){ decision.error=error.message; }
  });
  const active=[];
  for(const decision of decisions){
   if(decision.error){
    const requestedItem=requested.has(decision.base.id)&&action==='update';
    if(requestedItem)throw new Error(`无法获取 ${decision.base.title} 的最新版本：${decision.error}`);
    skipped.push(`${decision.base.title}：${decision.error}`);continue;
   }
   if(!sha.test(decision.revision??''))throw new Error(`无法获取 ${decision.base.title} 的版本`);
   if(action!=='repair'&&decision.installed?.revision===decision.revision){this.log(`${decision.base.title} 已是最新`);continue;}
   active.push(decision);
  }
  return {active,skipped};
 }
 async transaction(action,ids){
  const unlock=await this.lock();let journal=null;
  try{
   const interrupted=await json(join(this.root,'journal.json'),null);if(interrupted)await this.rollback(interrupted);
   const state=await this.state();
   if(action==='repair')ids=['planners-review-core',...Object.keys(state.installed)];
   if(action==='update-all')ids=Object.keys(state.installed);
   if(action==='update')for(const id of ids)if(!state.installed[id])throw new Error('只能更新由 Planners Form 安装的 Skill');
   const plan=closure(this.catalog,['planners-review-core',...ids]);
   await mkdir(this.skills,{recursive:true});await mkdir(this.mounts,{recursive:true});
   const {active,skipped}=await this.plan(action,plan,state,new Set(ids));
   if(skipped.length)this.log(`跳过：${skipped.join('；')}`);
   if(active.length===0){
    if(skipped.length)throw new Error(`未能更新：${skipped.join('；')}`);
    this.log('所有选中项都已是最新');return;
   }
   const dir=join(this.root,'staging',randomUUID());await mkdir(join(dir,'backup'),{recursive:true});
   journal={dir,state,items:[]}; const next=structuredClone(state);
   for(const decision of active){
    const base=decision.base;
    this.log(`下载 ${base.title} · ${decision.revision.slice(0,8)}`);
    await this.download({...base,revision:decision.revision},join(dir,base.id));
    journal.items.push({id:base.id,hadTarget:await exists(join(this.skills,base.id)),hadMount:await exists(join(this.mounts,base.id))});
    next.installed[base.id]={revision:decision.revision,installedAt:new Date().toISOString()};
   }
   if(plan.some(p=>p.runtime==='ppt'))await this.preparePython();
   // Write intent before the first activation. Recovery restores every old directory and state.
   await atomic(join(this.root,'journal.json'),journal);
   for(const item of journal.items){
    const target=join(this.skills,item.id),mount=join(this.mounts,item.id);
    const current=await this.ownership(item.id,state);if(current==='external')throw new Error('安装期间目录被其他程序修改，已停止');
    if(item.hadTarget)await rename(target,join(dir,'backup',item.id));
    await rename(join(dir,item.id),target);
    if(!item.hadMount)await symlink(target,mount,process.platform==='win32'?'junction':'dir');
   }
   await atomic(this.stateFile,next);await rm(join(this.root,'journal.json'),{force:true});
   await rm(dir,{recursive:true,force:true});journal=null;this.invalidateSkills();await this.onEnvironment(await this.environment());
   this.log(skipped.length?`已完成，${skipped.length} 项跳过`:'本次操作已完成');
  }catch(e){if(journal){if(await exists(join(this.root,'journal.json')))await this.rollback(journal);else await rm(journal.dir,{recursive:true,force:true});}throw e;}
  finally{await unlock();}
 }
 async recordSelfUpdate(record){
  const state=await this.state();
  await atomic(this.stateFile,{...state,lastSelfUpdate:record});
 }
 async selfUpdate(){
  if(!this.hostPluginManager)throw new Error('当前 DSH 没有提供插件管理服务，无法一键更新；请复制“更新指令”交给 Agent 执行。');
  const info=await this.pluginInfoBase();
  if(info.mode!=='github')throw new Error('当前是本地开发或外部安装，不能自动更新；请在开发目录更新。');
  this.log('解析插件最新版本');
  const commit=await this.resolveCommit(PLUGIN_REPOSITORY,PLUGIN_CHANNEL,{fetcher:this.fetcher});
  if(info.commit===commit){await this.recordSelfUpdate({state:'latest',target:commit,finishedAt:new Date().toISOString()});this.log('插件已是最新');return;}
  const startedAt=new Date().toISOString();
  await this.recordSelfUpdate({state:'running',target:commit,startedAt});
  this.log(`更新插件到 ${commit.slice(0,8)}（更新期间页面可能短暂断开）`);
  try{
   const result=await this.hostPluginManager.installBundle(`github:${PLUGIN_REPOSITORY}#${commit}`,{});
   const application=result?.application??null;
   const record={state:'done',application,target:commit,version:result?.version??null,restartReason:result?.restartReason??null,finishedAt:new Date().toISOString()};
   await this.recordSelfUpdate(record);
   this.log(application==='restart-required'?'插件已更新，重启 DSH 后生效':'插件已更新');
  }catch(error){
   await this.recordSelfUpdate({state:'error',message:error.message,target:commit,finishedAt:new Date().toISOString()});
   throw error;
  }
 }
 async diagnostics({kind='fix',reviewReady=false}={}) {
  const state=await this.state();const discovered=await this.detectedSkills();
  const rows=[];
  for(const pkg of this.catalog.packages){
   if(state.installed[pkg.id]===undefined)continue;
   const ownership=await this.ownership(pkg.id,state,discovered);
   rows.push({id:pkg.id,ownership,installedRevision:state.installed[pkg.id]?.revision??null,update:ownership==='managed'?this.updates[pkg.id]??null:null,checkError:this.checkErrors[pkg.id]??null});
  }
  const snapshot=buildSnapshot({
   plugin:this.pluginCache??await this.pluginInfoBase(),
   environment:await this.environment(),
   review:{ready:reviewReady},
   paths:{root:this.root,skills:this.skills,mounts:this.mounts,stateFile:this.stateFile,staging:this.staging,python:join(this.root,'python')},
   skills:{installed:state.installed,updates:this.updates,checkErrors:this.checkErrors,rows},
   job:{state:this.job?.state??null,message:this.job?.message??null,logTail:this.job?.log?.join('\n')??null},
   lastSelfUpdate:state.lastSelfUpdate??null,
   errors:[this.checkError,this.job?.state==='error'?this.job.message:null,this.pluginCache?.error??null,this.lastPythonError].filter(Boolean),
  });
  return {snapshot,prompt:kind==='update'?renderUpdatePrompt(snapshot):renderFixPrompt(snapshot)};
 }
 async preparePython(){
  if((await this.environment()).pythonReady)return;
  this.log('准备 PPT 的 Python 环境');
  const root=join(this.root,'python'),binary=join(root,process.platform==='win32'?'Scripts/python.exe':'bin/python3');
  try{
   if(!existsSync(binary)){
    const bundled=join(this.home,'dsh-runtimes','dsh-primary-runtime','dependencies','python',process.platform==='win32'?'python.exe':'bin/python3');
    const systemPython=existsSync(bundled)?bundled:'python3';
    try{await this.run(systemPython,['-c','import sys; assert sys.version_info >= (3,10)'],{timeout:10000});await this.run(systemPython,['-m','venv',root],{timeout:120000});}
    catch{try{await this.run('uv',['venv','--python','3.12',root],{timeout:180000});}catch{throw new Error('需要 Python 3.10+ 或 uv。安装其中之一后点击“检查 / 修复”；未更改已安装 Skill。');}}
   }
   const options={timeout:300000,maxBuffer:1024*1024};
   try{await this.run(binary,['-m','pip','--version'],{timeout:10000});}
   catch{await this.run(binary,['-m','ensurepip'],options);}
   await this.run(binary,['-m','pip','install','python-pptx>=0.6.21','lxml>=4.9','Pillow>=10','playwright>=1.40'],options);
   await this.run(binary,['-m','playwright','install','chromium'],options);
   if(!(await this.environment()).pythonReady)throw new Error('Python 环境验证失败');
  }catch(error){this.lastPythonError=String(error?.stderr||error?.message||error);throw error;}
 }
}
