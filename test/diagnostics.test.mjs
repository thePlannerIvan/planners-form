import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapshot,renderFixPrompt,renderUpdatePrompt,scrub} from '../lib/diagnostics.js';
const plugin={version:'0.2.0',commit:'3ab093c51fe6b371deddf09b1da699041677b40a',mode:'github',spec:'github:thePlannerIvan/planners-form',profile:'desktop',profileDir:'/Users/ivan/.dsh/profiles/desktop',latestVersion:'0.2.1',latestCommit:'b'.repeat(40),updateAvailable:true,canSelfUpdate:true};
const snapshot=buildSnapshot({plugin,environment:{pythonReady:false,lastPythonError:null},review:{ready:true},paths:{root:'/Users/ivan/.dsh/planners-form',skills:'/Users/ivan/.dsh/planners-form/skills',mounts:'/Users/ivan/.dsh/skills',stateFile:'/Users/ivan/.dsh/planners-form/state.json',staging:'/Users/ivan/.dsh/planners-form/staging',python:'/Users/ivan/.dsh/planners-form/python'},skills:{installed:{'planners-review-core':{revision:'a'.repeat(40),installedAt:'2026-10-20T00:00:00.000Z'}},updates:{},checkErrors:{},rows:[{id:'planners-review-core',ownership:'managed',installedRevision:'a'.repeat(40),update:null,checkError:'HTTP 403 token=abc123'}]},job:{state:'error',message:'Authorization: Bearer nope',logTail:'line1\nline2'},lastSelfUpdate:null,errors:['token=secret-value']});
test('snapshot is explicit, redacted and free of credentials',()=>{
 assert.equal(snapshot.redacted,true);
 assert.equal(snapshot.plugin.version,'0.2.0');
 const serialized=JSON.stringify(snapshot);
 assert.equal(serialized.includes('abc123'),false);
 assert.equal(serialized.includes('secret-value'),false);
 assert.equal(serialized.includes('Bearer nope'),false);
});
test('fix prompt includes facts, paths and classified repair instructions with no placeholders',()=>{
 const prompt=renderFixPrompt(snapshot);
 for(const text of ['任务：修复本机 Planners Form','/Users/ivan/.dsh/planners-form/state.json','## 6. 分类处置','## 7. 验收标准'])assert.ok(prompt.includes(text),`missing ${text}`);
 assert.equal(/\{\{[^}]+\}\}/.test(prompt),false);
 assert.equal(prompt.includes('abc123'),false);
});
test('update prompt names the exact target spec and both supported paths',()=>{
 const prompt=renderUpdatePrompt(snapshot);
 assert.match(prompt,/github:thePlannerIvan\/planners-form#b{40}/);
 assert.match(prompt,/plugin_manager/);
 assert.match(prompt,/runtime\/cli\/bin\/dsh/);
 assert.match(prompt,/restart-required/);
 assert.equal(/\{\{[^}]+\}\}/.test(prompt),false);
});
test('scrub removes credential-shaped text from messages',()=>{
 assert.equal(scrub('token=abc cookie=def password: ghi').includes('abc'),false);
 assert.equal(scrub('https://x.test/api?token=zzz&key=yyy').includes('zzz'),false);
});
test('a local preview ahead of the latest release is described as such, with a readable install mode',()=>{
 const preview=buildSnapshot({plugin:{...plugin,ahead:true,mode:'file',spec:'file:/tmp/preview.tgz'},environment:{},review:{},paths:{},skills:{},job:{},lastSelfUpdate:null,errors:[]});
 const text=renderFixPrompt(preview);
 assert.match(text,/本地预览版，新于最新发布/);
 assert.match(text,/本地文件包（file:\/tmp\/preview\.tgz）/);
 assert.equal(text.includes('不要要求用户联系插件作者'),false);
});
test('the fix prompt ends with an email fallback for unfixable or optimization cases',()=>{
 const text=renderFixPrompt(snapshot);
 assert.match(text,/## 9\. 修不好或发现可优化点时/);
 assert.match(text,/Lawyif@163\.com/);
 assert.match(text,/仍无法修复/);
 assert.match(text,/值得优化的地方/);
 assert.equal(text.includes('不要要求用户联系插件作者'),false);
});
test('the repair prompt does not contradict the email fallback and checks both skill roots',()=>{
 const text=renderFixPrompt(snapshot);
 assert.equal(text.includes('在不联系插件作者的前提下'),false);
 assert.match(text,/按第 9 节把诊断书发给作者/);
 assert.match(text,/"\/Users\/ivan\/\.dsh\/planners-form\/skills" "\/Users\/ivan\/\.dsh\/skills"/);
});
