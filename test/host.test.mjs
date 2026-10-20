import test from 'node:test';import assert from 'node:assert/strict';
import {createHandler} from '../lib/index.js';
const manager={status:async()=>({packages:[]}),checkUpdates:async()=>({packages:[]}),start:(action,ids)=>({action,ids}),diagnostics:async({kind})=>({prompt:`prompt:${kind}`,snapshot:{schema:1,redacted:true}})};
const handler=createHandler(manager,{token:'test-token'});
const req=(body,extra={})=>new Request('http://localhost/api/planners-form',{method:'POST',headers:{'content-type':'application/json','x-planners-token':'test-token',...extra},body:JSON.stringify(body)});
test('status includes a scoped write token',async()=>{const r=await handler(new Request('http://localhost/api/planners-form'));assert.equal(r.status,200);assert.equal((await r.json()).token,'test-token');});
test('rejects missing token',async()=>{assert.equal((await handler(req({action:'repair'},{'x-planners-token':''}))).status,403);});
test('rejects hostile origin',async()=>{assert.equal((await handler(req({action:'repair'},{origin:'https://evil.test'}))).status,403);});
test('rejects cross-site and non-json',async()=>{assert.equal((await handler(req({action:'repair'},{'sec-fetch-site':'cross-site'}))).status,403);assert.equal((await handler(req({action:'repair'},{'content-type':'text/plain'}))).status,415);});
test('accepts same-origin user installation action',async()=>{const r=await handler(req({action:'install',ids:['feature']},{origin:'http://localhost'}));assert.equal(r.status,202);assert.equal((await r.json()).job.action,'install');});
test('accepts a self-update action as a job',async()=>{const r=await handler(req({action:'self-update'},{origin:'http://localhost'}));assert.equal(r.status,202);assert.equal((await r.json()).job.action,'self-update');});
test('diagnose returns the prompt without a token',async()=>{const r=await handler(req({action:'diagnose',kind:'update'}));assert.equal(r.status,200);const body=await r.json();assert.equal(body.prompt,'prompt:update');assert.equal(JSON.stringify(body).includes('test-token'),false);});
test('malformed payload and oversized requests fail explicitly',async()=>{assert.equal((await handler(new Request('http://localhost/api/planners-form',{method:'POST',headers:{'content-type':'application/json','x-planners-token':'test-token'},body:'{'}))).status,400);assert.equal((await handler(req({data:'x'.repeat(20000)}))).status,413);});

test('DSH internal request URL uses fenced Host for origin comparison',async()=>{const r=await handler(new Request('http://dsh.internal/api/planners-form',{method:'POST',headers:{host:'127.0.0.1:3197',origin:'http://127.0.0.1:3197','content-type':'application/json','x-planners-token':'test-token'},body:JSON.stringify({action:'check'})}));assert.equal(r.status,200);});
