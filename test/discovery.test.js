import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {PUBLIC_ORIGIN} from '../src/discovery.js';
import {tradeInput} from '../src/input.js';
import {buy} from './fixtures.js';

test('public documentation works without API credentials or RPC and has crawlable identity',async()=>{
  const response=await worker.fetch(new Request(PUBLIC_ORIGIN+'/'));
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/html/);
  const html=await response.text();
  assert.match(html,/<title>Pumpfun Buy Sell API/);
  assert.ok(html.includes(`<link rel="canonical" href="${PUBLIC_ORIGIN}/">`));
  assert.match(html,/0\.25% service fee/);
  assert.match(html,/first trader funds its creation/);
  assert.doesNotMatch(html,/<script\b|noindex/i);
  assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
});

test('documentation does not reflect attacker-controlled query or origin in HTML and canonical links',async()=>{
  const response=await worker.fetch(new Request('https://attacker.example/?q=%3Cscript%3Ebad%3C%2Fscript%3E'));
  const html=await response.text();
  assert.ok(html.includes(`<link rel="canonical" href="${PUBLIC_ORIGIN}/">`));
  assert.doesNotMatch(html,/attacker\.example|<script>/);
});

test('published buy and sell examples match the current request contract after replacing addresses',async()=>{
  const html=await (await worker.fetch(new Request(PUBLIC_ORIGIN+'/'))).text();
  const blocks=[...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map(match=>match[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));
  assert.equal(blocks.length,2);
  assert.match(blocks[0],/\\\n  -H "Content-Type: application\/json" \\\n  --data '/);
  const bodies=[JSON.parse(blocks[0].match(/--data '(.*)'/)[1]),JSON.parse(blocks[1])];
  for(const [index,body] of bodies.entries()){
    const input=tradeInput({...body,publicKey:buy.publicKey,mint:buy.mint});
    assert.equal(input.action,index===0?'buy':'sell');
    assert.equal(input.pool,'auto');assert.equal(input.simulate,true);assert.equal(input.maxServiceFeeBps,25);
  }
});

test('crawler files expose only the public document, support HEAD and reject other methods',async()=>{
  for(const path of ['/','/robots.txt','/sitemap.xml']){
    const head=await worker.fetch(new Request(PUBLIC_ORIGIN+path,{method:'HEAD'}));
    assert.equal(head.status,200);assert.equal(await head.text(),'');
    const post=await worker.fetch(new Request(PUBLIC_ORIGIN+path,{method:'POST'}));
    assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
  }
  const robots=await (await worker.fetch(new Request(PUBLIC_ORIGIN+'/robots.txt'))).text();
  assert.ok(robots.includes(`Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`));
  assert.ok(robots.includes('Disallow: /api/'));
  const sitemap=await (await worker.fetch(new Request(PUBLIC_ORIGIN+'/sitemap.xml'))).text();
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]),[PUBLIC_ORIGIN+'/']);
});

test('static page routing cannot bypass trading API authentication or public rate limits',async()=>{
  const locked=await worker.fetch(new Request(PUBLIC_ORIGIN+'/api/trade/local',{method:'POST'}),{ACCESS_MODE:'key',API_KEY:'test-only'});
  assert.equal(locked.status,401);
  const request=new Request(PUBLIC_ORIGIN+'/api/trade/local',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.1'}});
  Object.defineProperty(request,'cf',{value:{colo:'TEST'}});
  const response=await worker.fetch(request,{ACCESS_MODE:'public',PUBLIC_RATE_LIMITER:{limit:async()=>({success:false})},PUBLIC_TOTAL_LIMITER:{limit:async()=>({success:true})}});
  assert.equal(response.status,429);
  assert.equal(response.headers.get('retry-after'),'60');
  const health=await worker.fetch(new Request(PUBLIC_ORIGIN+'/api/health'));
  assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
});
