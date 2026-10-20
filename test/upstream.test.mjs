import test from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions,resolveCommit,resolveRelease} from '../lib/upstream.js';
const sha='3ab093c51fe6b371deddf09b1da699041677b40a';
const text=body=>async()=>new Response(body);
test('resolves a commit from git refs without the REST API',async()=>{
 let urls=[];const fetcher=async url=>{urls.push(url);return new Response(`001e# service=git-upload-pack\n0000${sha} refs/heads/main\0multi_ack thin-pack`);};
 assert.equal(await resolveCommit('thePlannerIvan/planners-form','main',{fetcher}),sha);
 assert.match(urls[0],/info\/refs\?service=git-upload-pack/);
});
test('falls back to the commits atom feed when refs are unavailable',async()=>{
 const fetcher=async url=>{if(url.includes('info/refs'))throw Error('proxy refused');return new Response(`<?xml version="1.0"?><feed><entry><id>tag:github.com,2008:Grit::Commit/${sha}</id></entry></feed>`);};
 assert.equal(await resolveCommit('thePlannerIvan/planners-form','main',{fetcher}),sha);
});
test('falls back to the REST API last and reports every attempt',async()=>{
 const fetcher=async url=>{if(url.includes('info/refs'))throw Error('refs down');if(url.includes('.atom'))throw Error('atom down');return new Response(JSON.stringify({sha}));};
 assert.equal(await resolveCommit('thePlannerIvan/planners-form','main',{fetcher}),sha);
 const failing=async()=>{throw Error('offline');};
 await assert.rejects(resolveCommit('thePlannerIvan/planners-form','main',{fetcher:failing}),/refs: offline；atom: offline；api: offline/);
});
test('rejects malformed repository and channel input before any request',async()=>{
 let called=false;const fetcher=async()=>{called=true;return new Response('');};
 await assert.rejects(resolveCommit('../evil','main',{fetcher}),/无效/);
 await assert.rejects(resolveCommit('thePlannerIvan/planners-form','ma in',{fetcher}),/无效/);
 assert.equal(called,false);
});
test('resolves the latest release version from releases.atom',async()=>{
 const fetcher=text(`<feed><entry><id>tag:github.com,2008:Repository/1416717223/v0.2.0</id><updated>2026-10-20T00:00:00Z</updated><title>Planners Form 0.2.0</title></entry><entry><id>tag:github.com,2008:Repository/1416717223/v0.1.4</id><updated>2026-10-17T00:00:00Z</updated><title>Planners Form 0.1.4</title></entry></feed>`);
 const latest=await resolveRelease('thePlannerIvan/planners-form',{fetcher});
 assert.equal(latest.version,'0.2.0');assert.equal(latest.tag,'v0.2.0');
});
test('resolveRelease falls back to tags in git refs',async()=>{
 const fetcher=async url=>{if(url.includes('releases.atom'))throw Error('no feed');return new Response(`0000${sha} refs/tags/v0.1.4\n${sha} refs/tags/v0.2.0\n${sha} refs/tags/v0.1.3`);};
 const latest=await resolveRelease('thePlannerIvan/planners-form',{fetcher});
 assert.equal(latest.version,'0.2.0');
});
test('compares semver including prereleases and rejects non-semver',()=>{
 assert.ok(compareVersions('0.2.0','0.1.4')>0);
 assert.ok(compareVersions('0.2.0-rc.2','0.2.0')<0);
 assert.ok(compareVersions('0.2.0-rc.10','0.2.0-rc.9')>0);
 assert.equal(compareVersions('main','0.2.0'),null);
 assert.equal(compareVersions('0.2.0','0.2.0'),0);
});
