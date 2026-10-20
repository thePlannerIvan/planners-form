import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readlink,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Manager,closure,downloadPackage,profileFromInstallFile} from '../lib/manager.js';
const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
const pkg=(id,deps=[])=>({id,title:id,available:true,repository:'thePlannerIvan/'+id,channel:'main',dependencies:deps});
const catalog={packages:[pkg('planners-review-core'),pkg('core'),pkg('feature',['core']),{id:'private',available:false}]};
const release=async()=>({version:'0.1.0',tag:'v0.1.0',publishedAt:null});
async function fixture(t,options={}) {const home=await mkdtemp(join(tmpdir(),'planners-form-test-'));t.after(()=>rm(home,{recursive:true,force:true}));const saved={profile:process.env.DSH_PROFILE,dir:process.env.DSH_PROFILE_DIR};delete process.env.DSH_PROFILE;delete process.env.DSH_PROFILE_DIR;t.after(()=>{if(saved.profile===undefined)delete process.env.DSH_PROFILE;else process.env.DSH_PROFILE=saved.profile;if(saved.dir===undefined)delete process.env.DSH_PROFILE_DIR;else process.env.DSH_PROFILE_DIR=saved.dir;});const download=async(p,d)=>{await mkdir(d,{recursive:true});await writeFile(join(d,'SKILL.md'),`---\nname: ${p.id}\ndescription: Fixture\n---\n${p.revision}`);};return new Manager({home,catalog,download,resolveCommit:async()=>b,resolveRelease:release,...options});}
async function run(m,action,ids){m.start(action,ids);await m.running;return m.job;}
async function fakeProfile(t,commit=b){
 const dir=await mkdtemp(join(tmpdir(),'pf-profile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'package.json'),JSON.stringify({dependencies:{'planners-form':'github:thePlannerIvan/planners-form'}}));
 await writeFile(join(dir,'pnpm-lock.yaml'),`planners-form@https://codeload.github.com/thePlannerIvan/planners-form/tar.gz/${commit}:\n  resolution: {integrity: x}\n`);
 const before={profile:process.env.DSH_PROFILE,dir:process.env.DSH_PROFILE_DIR};
 process.env.DSH_PROFILE='desktop';process.env.DSH_PROFILE_DIR=dir;
 t.after(()=>{if(before.profile===undefined)delete process.env.DSH_PROFILE;else process.env.DSH_PROFILE=before.profile;if(before.dir===undefined)delete process.env.DSH_PROFILE_DIR;else process.env.DSH_PROFILE_DIR=before.dir;});
 return dir;
}
test('dependency closure is ordered, unique, rejects unknown and cycles',()=>{assert.deepEqual(closure(catalog,['feature','core']).map(p=>p.id),['core','feature']);assert.throws(()=>closure(catalog,['../evil']));assert.throws(()=>closure({packages:[pkg('a',['b']),pkg('b',['a'])]},['a']));});
test('installs all dependencies once and mounts DSH-visible skill directories',async t=>{const m=await fixture(t);assert.equal((await run(m,'install',['feature'])).state,'done');assert.equal((await m.status()).packages.find(p=>p.id==='feature').ownership,'managed');assert.equal(await readlink(join(m.mounts,'feature')),join(m.skills,'feature'));assert.deepEqual(Object.keys((await m.state()).installed),['planners-review-core','core','feature']);assert.equal((await m.state()).installed.feature.revision,b);});
test('install resolves the latest commit instead of using a catalog revision',async t=>{const seen=[];const m=await fixture(t,{download:async(p,d)=>{seen.push(p.revision);await mkdir(d,{recursive:true});await writeFile(join(d,'SKILL.md'),`---\nname: ${p.id}\n---\n`);}});await run(m,'install',['feature']);assert.deepEqual([...new Set(seen)],[b]);});
test('external installation is preserved byte-for-byte',async t=>{const m=await fixture(t);await mkdir(join(m.mounts,'feature'),{recursive:true});await writeFile(join(m.mounts,'feature','SKILL.md'),'mine');await run(m,'install',['feature']);assert.equal(await readFile(join(m.mounts,'feature','SKILL.md'),'utf8'),'mine');assert.equal((await m.status()).packages.find(p=>p.id==='feature').ownership,'external');assert.equal((await m.state()).installed.feature,undefined);});
test('failed staged download never changes an existing install',async t=>{const m=await fixture(t);await run(m,'install',['feature']);const original=await readFile(join(m.skills,'feature','SKILL.md'),'utf8');m.download=async()=>{throw Error('offline');};await run(m,'repair');assert.equal(m.job.state,'error');assert.equal(await readFile(join(m.skills,'feature','SKILL.md'),'utf8'),original);assert.equal((await m.state()).installed.feature.revision,b);});
test('missing managed mount is repaired',async t=>{const m=await fixture(t);await run(m,'install',['feature']);await rm(join(m.mounts,'feature'));await run(m,'repair');assert.equal(m.job.state,'done');assert.equal(await readlink(join(m.mounts,'feature')),join(m.skills,'feature'));});
test('replaced external mount is never overwritten on repair',async t=>{const m=await fixture(t);await run(m,'install',['feature']);await rm(join(m.mounts,'feature'));await mkdir(join(m.mounts,'feature'));await writeFile(join(m.mounts,'feature','SKILL.md'),'external');await run(m,'repair');assert.equal(await readFile(join(m.mounts,'feature','SKILL.md'),'utf8'),'external');});
test('concurrent operations are rejected',async t=>{let release;const m=await fixture(t,{download:async()=>{await new Promise(r=>release=r);throw Error('test completed');}});m.start('install',['feature']);assert.throws(()=>m.start('repair'),/正在进行/);while(!release)await new Promise(r=>setTimeout(r,1));release();await m.running;});
test('check updates reports newer commits without changing files; update installs them',async t=>{let latest=b;const m=await fixture(t,{resolveCommit:async()=>latest});await run(m,'install',['feature']);latest=c;await m.checkUpdates();assert.equal((await m.state()).installed.feature.revision,b);assert.equal((await m.status()).packages.find(p=>p.id==='feature').update,c);await run(m,'update',['feature']);assert.equal(m.job.state,'done');assert.equal((await m.state()).installed.feature.revision,c);});
test('update re-resolves the latest commit instead of reusing the checked one',async t=>{let latest=b;const m=await fixture(t,{resolveCommit:async()=>latest});await run(m,'install',['feature']);latest=c;await m.checkUpdates();latest=a;await run(m,'update',['feature']);assert.equal((await m.state()).installed.feature.revision,a);});
test('a failed resolution is reported per item and does not block the others',async t=>{let latest=b;let fail=null;const m=await fixture(t,{resolveCommit:async repo=>{if(fail!==null&&repo.includes(fail))throw Error('HTTP 403');return latest;}});await run(m,'install',['feature']);latest=c;fail='core';const status=await m.checkUpdates();assert.match(status.checkError,/core/);assert.notEqual(status.packages.find(p=>p.id==='core').checkError,null);assert.equal(status.packages.find(p=>p.id==='feature').update,c);});
test('update-all skips an item whose latest version cannot be resolved',async t=>{let latest=b;let fail=null;const m=await fixture(t,{resolveCommit:async repo=>{if(fail!==null&&repo.includes(fail))throw Error('HTTP 403');return latest;}});await run(m,'install',['feature']);latest=c;fail='core';await run(m,'update-all');assert.equal(m.job.state,'done',m.job.message);assert.match(m.job.message,/跳过/);assert.equal((await m.state()).installed.feature.revision,c);assert.equal((await m.state()).installed.core.revision,b);});
test('check failure no longer blocks an unrelated update',async t=>{let latest=b;let fail=false;const m=await fixture(t,{resolveCommit:async repo=>{if(fail&&repo.includes('core'))throw Error('blocked');return latest;}});await run(m,'install',['feature']);latest=c;fail=true;await m.checkUpdates();assert.match(m.checkError,/core/);await run(m,'update',['feature']);assert.equal(m.job.state,'done',m.job.message);assert.equal((await m.state()).installed.feature.revision,c);});
test('update failure is shown, never silently treated as latest',async t=>{const m=await fixture(t,{resolveCommit:async()=>{throw Error('HTTP 403');}});await mkdir(join(m.root,'skills','feature'),{recursive:true});await writeFile(join(m.skills,'feature','SKILL.md'),'---\nname: feature\n---\n');await mkdir(m.root,{recursive:true});await writeFile(join(m.root,'state.json'),JSON.stringify({schema:1,installed:{feature:{revision:a,installedAt:'2026-01-01T00:00:00.000Z'}}}));await run(m,'update',['feature']);assert.equal(m.job.state,'error');assert.equal((await m.state()).installed.feature.revision,a);});
test('rejects arbitrary download sources and bad versions',async()=>{await assert.rejects(downloadPackage({repository:'evil/repo',revision:a},'/tmp/unused'),/无效/);await assert.rejects(downloadPackage({repository:'thePlannerIvan/test',revision:'main'},'/tmp/unused'),/无效/);});
test('cross-process lock refuses live owner',async t=>{const m=await fixture(t);await mkdir(m.root,{recursive:true});await writeFile(join(m.root,'install.lock'),JSON.stringify({pid:process.pid}));await run(m,'repair');assert.equal(m.job.state,'error');assert.match(m.job.message,/另一个/);});
test('interrupted activation is rolled back before next operation',async t=>{const m=await fixture(t);await run(m,'install',['feature']);const state=await m.state(),dir=join(m.root,'staging','crash');await mkdir(join(dir,'backup'),{recursive:true});const {rename}=await import('node:fs/promises');await rename(join(m.skills,'feature'),join(dir,'backup','feature'));await mkdir(join(m.skills,'feature'));await writeFile(join(m.skills,'feature','SKILL.md'),'partial');await writeFile(join(m.root,'journal.json'),JSON.stringify({dir,state,items:[{id:'feature',hadTarget:true,hadMount:true}]}));m.download=async()=>{throw Error('offline');};await run(m,'repair');assert.match(await readFile(join(m.skills,'feature','SKILL.md'),'utf8'),new RegExp(b));assert.equal((await m.state()).installed.feature.revision,b);});
test('external shared dependencies are visible beside managed skills',async t=>{const m=await fixture(t);await mkdir(join(m.mounts,'core'),{recursive:true});await writeFile(join(m.mounts,'core','SKILL.md'),'external core');await run(m,'install',['feature']);assert.equal(m.job.state,'done');assert.equal(await readFile(join(m.skills,'core','SKILL.md'),'utf8'),'external core');});
test('cached checks do not re-resolve; explicit checks do',async t=>{let calls=0;const m=await fixture(t,{resolveCommit:async()=>{calls++;return b;}});await m.checkUpdates(false);const before=calls;await m.checkUpdates(false);assert.equal(calls,before);await m.checkUpdates(true);assert.ok(calls>before);});
test('real tar download extracts matching Skill and excludes secrets',async t=>{const m=await fixture(t);const {create}=await import('tar');const src=join(m.home,'archive-root');await mkdir(join(src,'bundle'),{recursive:true});await writeFile(join(src,'bundle','SKILL.md'),'---\nname: core\ndescription: test\n---\nHello');await writeFile(join(src,'bundle','.env'),'not-shipped');const file=join(m.home,'fixture.tgz');await create({cwd:src,gzip:true,file},['bundle']);const data=await readFile(file),dest=join(m.home,'download');await downloadPackage({...pkg('core'),revision:a},dest,async()=>new Response(data));assert.match(await readFile(join(dest,'SKILL.md'),'utf8'),/Hello/);await assert.rejects(lstat(join(dest,'.env')),{code:'ENOENT'});});
test('real tar rejects symlinks rather than following them',async t=>{const m=await fixture(t);const {create}=await import('tar');const src=join(m.home,'archive-root');await mkdir(join(src,'bundle'),{recursive:true});await symlink('/tmp',join(src,'bundle','outside'));const file=join(m.home,'fixture.tgz');await create({cwd:src,gzip:true,file},['bundle']);const data=await readFile(file);await assert.rejects(downloadPackage({...pkg('core'),revision:a},join(m.home,'download'),async()=>new Response(data)),/不支持/);});
test('uses registry names and resource paths from arbitrary DSH roots without copying external skills',async t=>{
 const m=await fixture(t);const external=join(m.home,'library','category','different-folder');await mkdir(external,{recursive:true});await writeFile(join(external,'SKILL.md'),'user content');
 m.discover=async()=>[{name:'feature',resourceBase:{kind:'directory',path:external}}];
 assert.equal((await m.status()).packages.find(p=>p.id==='feature').ownership,'external');
 assert.equal((await run(m,'install',['feature'])).state,'done');
 assert.equal(await readlink(join(m.skills,'feature')),external);
 await assert.rejects(lstat(join(m.mounts,'feature')),{code:'ENOENT'});
 assert.equal(await readFile(join(external,'SKILL.md'),'utf8'),'user content');
});
test('realpath aliases from DSH discovery remain managed and updateable',async t=>{
 const m=await fixture(t);await run(m,'install',['feature']);
 const alias=join(m.home,'alias');await symlink(m.skills,alias);
 m.discover=async()=>[{name:'feature',path:join(alias,'feature','SKILL.md')}];
 assert.equal((await m.status()).packages.find(p=>p.id==='feature').ownership,'managed');
});
test('discovery errors stop install rather than duplicating unseen external skills',async t=>{
 const m=await fixture(t,{discover:async()=>{throw Error('discovery unavailable');}});
 assert.equal((await run(m,'install',['feature'])).state,'error');
 assert.match(m.job.message,/discovery unavailable/);assert.deepEqual((await m.state()).installed,{});
});
test('directory without SKILL.md is not shown installed and is not overwritten',async t=>{
 const m=await fixture(t);await mkdir(join(m.mounts,'feature'),{recursive:true});await writeFile(join(m.mounts,'feature','keep.txt'),'keep');
 assert.equal((await m.status()).packages.find(p=>p.id==='feature').ownership,'absent');
 assert.equal((await run(m,'install',['feature'])).state,'error');
 assert.equal(await readFile(join(m.mounts,'feature','keep.txt'),'utf8'),'keep');
});
test('successful installs invalidate the DSH catalog immediately',async t=>{
 let invalidations=0;const m=await fixture(t,{invalidateSkills:()=>invalidations++});
 await run(m,'install',['feature']);assert.equal(invalidations,1);
});
test('self-update refuses without the host plugin manager',async t=>{
 const m=await fixture(t);await run(m,'install',['feature']);
 const job=await run(m,'self-update');
 assert.equal(job.state,'error');assert.match(job.message,/插件管理服务/);
});
test('self-update delegates to the host and records the outcome',async t=>{
 const calls=[];const m=await fixture(t,{resolveCommit:async()=>c});
 await fakeProfile(t,b);
 m.hostPluginManager={installBundle:async(spec,options)=>{calls.push({spec,options});return {application:'restart-required',version:'0.2.0',restartReason:'changed'};}};
 await run(m,'install',['feature']);
 const job=await run(m,'self-update');
 assert.equal(job.state,'done',job.message);
 assert.equal(calls.length,1);assert.equal(calls[0].spec,`github:thePlannerIvan/planners-form#${c}`);
 const state=await m.state();assert.equal(state.lastSelfUpdate.state,'done');assert.equal(state.lastSelfUpdate.application,'restart-required');
});
test('self-update surfaces host failures and keeps the previous install intact',async t=>{
 const m=await fixture(t,{resolveCommit:async()=>c});
 await fakeProfile(t,b);
 m.hostPluginManager={installBundle:async()=>{throw Error('pnpm failed');}};
 await run(m,'install',['feature']);
 const job=await run(m,'self-update');
 assert.equal(job.state,'error');assert.match(job.message,/pnpm failed/);
 assert.equal((await m.state()).lastSelfUpdate.state,'error');
 assert.equal((await m.state()).installed.feature.revision,c);
});
test('diagnostics builds a redacted snapshot and a ready-to-paste prompt',async t=>{
 const m=await fixture(t);await run(m,'install',['feature']);
 const fix=await m.diagnostics({kind:'fix'});
 assert.match(fix.prompt,/任务：修复本机 Planners Form/);
 assert.match(fix.prompt,/state\.json/);
 const update=await m.diagnostics({kind:'update'});
 assert.match(update.prompt,/任务：把本机的 Planners Form 插件更新到最新版/);
 assert.match(update.prompt,/plugin_manager/);
 const serialized=JSON.stringify(fix.snapshot);
 assert.equal(serialized.includes('x-planners-token'),false);
 assert.match(serialized,/"redacted":true/);
});
test('profile is derived from the installed package path when env vars are absent',async t=>{
 const saved={profile:process.env.DSH_PROFILE,dir:process.env.DSH_PROFILE_DIR};delete process.env.DSH_PROFILE;delete process.env.DSH_PROFILE_DIR;t.after(()=>{if(saved.profile===undefined)delete process.env.DSH_PROFILE;else process.env.DSH_PROFILE=saved.profile;if(saved.dir===undefined)delete process.env.DSH_PROFILE_DIR;else process.env.DSH_PROFILE_DIR=saved.dir;});
 const base=await mkdtemp(join(tmpdir(),'pf-derive-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const profileDir=join(base,'profiles','desktop');const packageFile=join(profileDir,'node_modules','planners-form','package.json');
 await mkdir(join(profileDir,'node_modules','planners-form'),{recursive:true});
 await writeFile(join(profileDir,'package.json'),JSON.stringify({dependencies:{'planners-form':'file:/tmp/preview.tgz'}}));
 await writeFile(join(profileDir,'pnpm-lock.yaml'),'');
 await writeFile(packageFile,JSON.stringify({name:'planners-form',version:'0.2.0'}));
 assert.deepEqual(profileFromInstallFile(packageFile),{profile:'desktop',profileDir});
 assert.equal(profileFromInstallFile('/opt/global/node_modules/planners-form/package.json'),null);
 const m=new Manager({home:join(base,'home'),catalog,packageFile,resolveRelease:async()=>({version:'0.1.4',tag:'v0.1.4'}),resolveCommit:async()=>b,download:async()=>{}});
 const info=await m.pluginInfoBase();
 assert.equal(info.profile,'desktop');assert.equal(info.profileDir,profileDir);
 assert.equal(info.mode,'file');assert.equal(info.spec,'file:/tmp/preview.tgz');
 const checked=await m.checkPlugin(true);
 assert.equal(checked.latestVersion,'0.1.4');assert.equal(checked.ahead,true);assert.equal(checked.updateAvailable,false);
});
test('profile derivation also handles pnpm virtual-store layouts',()=>{
 assert.deepEqual(profileFromInstallFile('/Users/ivan/.dsh/profiles/desktop/node_modules/.pnpm/planners-form@0.2.0/node_modules/planners-form/package.json'),{profile:'desktop',profileDir:'/Users/ivan/.dsh/profiles/desktop'});
});
