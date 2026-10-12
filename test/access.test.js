import test from 'node:test';import assert from 'node:assert/strict';import {createService} from '../src/service.js';
function request(ip='192.0.2.1'){const r=new Request('https://example.com/api/capabilities',{headers:{'CF-Connecting-IP':ip}});Object.defineProperty(r,'cf',{value:{colo:'TEST'}});return r;}
function env(){return {ACCESS_MODE:'public',TRADE_ENGINE:'jupiter',PUBLIC_RATE_LIMITER:{limit:async()=>({success:true})},PUBLIC_TOTAL_LIMITER:{limit:async()=>({success:true})}};}
const app=createService(()=>{throw new Error('Unexpected RPC');});
test('public mode needs no API key and fails closed without edge protections',async()=>{
 const r=await app.fetch(request(),env());assert.equal(r.status,200);assert.equal((await r.json()).apiKeyRequired,false);
 for(const part of [{PUBLIC_RATE_LIMITER:undefined},{PUBLIC_TOTAL_LIMITER:undefined},{ACCESS_MODE:'typo'}])assert.equal((await app.fetch(request(),{...env(),...part})).status,503);
 assert.equal((await app.fetch(new Request('https://example.com/api/capabilities'),env())).status,503);
});
test('public client and shared limits reject with Retry-After; failures do not bypass protection',async()=>{
 for(const binding of ['PUBLIC_RATE_LIMITER','PUBLIC_TOTAL_LIMITER']){
  const config=env();config[binding].limit=async()=>({success:false});const r=await app.fetch(request(),config);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');
  config[binding].limit=async()=>{throw new Error('unavailable');};assert.equal((await app.fetch(request(),config)).status,503);
 }
});
test('IPv6 addresses in the same /64 share a client limit',async()=>{
 const keys=[],config=env();config.PUBLIC_RATE_LIMITER.limit=async({key})=>{keys.push(key);return {success:true};};
 for(const ip of ['2001:db8:1:2::1','2001:0db8:0001:0002:0:0:1:ffff'])assert.equal((await app.fetch(request(ip),config)).status,200);
 assert.equal(keys[0],keys[1]);
});
