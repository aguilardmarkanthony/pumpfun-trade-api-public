import test from 'node:test';import assert from 'node:assert/strict';
import {SystemProgram,PublicKey} from '@solana/web3.js';
import {Rpc} from '../src/rpc.js';import {loadState,quoteState,instructions,tokenAccount} from '../src/protocol.js';import {tradeInput} from '../src/input.js';import {auditInstructions} from '../src/transaction.js';import {createService,trade} from '../src/service.js';import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {fixture,ENV,buy,USER,OTHER,MINT,tokenInfo} from './fixtures.js';
import adapter from '../vendor/bigint-buffer/index.cjs';
test('standalone bearer authentication accepts only the configured key',async()=>{
 const app=createService(()=>{throw new Error('Unexpected RPC');}),env={API_KEY:'test-key_123'};
 const call=(headers={},config=env)=>app.fetch(new Request('https://example.com/api/capabilities',{headers}),config);
 for(const authorization of ['Bearer test-key_123','bearer test-key_123'])assert.equal((await call({Authorization:authorization})).status,200);
 for(const authorization of ['', 'test-key_123','Basic test-key_123','Bearer wrong','Bearer test-key_123 extra','Bearer '+ 'x'.repeat(515)]){
  const response=await call({Authorization:authorization});assert.equal(response.status,401);assert.equal(response.headers.get('WWW-Authenticate'),'Bearer');assert.ok(!(await response.text()).includes(env.API_KEY));
 }
 assert.equal((await call({'X-API-Key':env.API_KEY})).status,401);
 assert.equal((await call({},{})).status,503);
 assert.equal((await call({Authorization:'Bearer test-key_123'},{API_KEY:' '})).status,503);
});
test('pure bigint adapter round trips widths and rejects overflow',()=>{
 for(const width of [0,1,2,4,8,16,32,64])for(const v of [0n,(1n<<BigInt(width*8))-1n]){
  assert.equal(adapter.toBigIntBE(adapter.toBufferBE(v,width)),v);assert.equal(adapter.toBigIntLE(adapter.toBufferLE(v,width)),v);
 }
 assert.throws(()=>adapter.toBufferBE(-1n,8));assert.throws(()=>adapter.toBufferLE(256n,1));assert.throws(()=>adapter.toBufferBE(1n,0));assert.throws(()=>adapter.toBufferBE(0n,1000000));
});
test('RPC restricts methods and rejects HTTP redirects without following',async()=>{
 let calls=0;const rpc=new Rpc({},async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://untrusted.example'}});});
 await assert.rejects(()=>rpc.call('sendTransaction',[]),/Forbidden/);assert.equal(calls,0);
 await assert.rejects(()=>rpc.accounts([MINT]),e=>e.code==='RPC_UNAVAILABLE');assert.equal(calls,1);
});
test('RPC fetch uses the global receiver required by Workers',async()=>{
 const rpc=new Rpc({},async function(){assert.equal(this,globalThis);return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{context:{slot:1},value:[null]}}));});
 assert.deepEqual(await rpc.accounts([MINT]),[null]);
});
test('RPC validates response IDs, slot regression, error and response size',async()=>{
 for(const body of [{jsonrpc:'2.0',id:2,result:{context:{slot:1},value:[]}}, {jsonrpc:'2.0',id:1,result:{context:{slot:0},value:[]}}, {jsonrpc:'2.0',id:1,error:{code:-1}}, 'x'.repeat(1048577)]){
  const rpc=new Rpc({},async()=>new Response(typeof body==='string'?body:JSON.stringify(body)));rpc.slot=1;
  await assert.rejects(()=>rpc.accounts([MINT]),e=>e.code==='RPC_UNAVAILABLE');
 }
});
test('RPC caps work and never returns upstream secrets',async()=>{
 const rpc=new Rpc({SOLANA_RPC_URL:'https://example.com/?key=secret'},async()=>{throw new Error('https://example.com/?key=secret');});
 await assert.rejects(()=>rpc.accounts([MINT]),e=>e.code==='RPC_UNAVAILABLE'&&!e.message.includes('secret'));
 rpc.calls=8;await assert.rejects(()=>rpc.accounts([MINT]),e=>e.code==='RPC_BUDGET_EXCEEDED');
});
test('account ownership and wrong mint cannot reach a quote',async()=>{
 const f=await fixture();f.accounts.get(MINT.toBase58()).owner=SystemProgram.programId;
 await assert.rejects(()=>loadState(f.rpc,tradeInput(buy)),e=>e.code==='INVALID_CHAIN_STATE');
 assert.throws(()=>tokenAccount(OTHER,tokenInfo(OTHER,USER,1n),MINT,USER,TOKEN_PROGRAM_ID),e=>e.code==='INVALID_CHAIN_STATE');
});
test('an added fee transfer, foreign signer or altered slippage is rejected',async()=>{
 const f=await fixture(),input=tradeInput(buy),state=await loadState(f.rpc,input),quote=quoteState(state,input),ixs=await instructions(state,input,quote);
 const transfer=SystemProgram.transfer({fromPubkey:USER,toPubkey:OTHER,lamports:1});
 assert.throws(()=>auditInstructions([...ixs,transfer],input,state,quote),e=>e.code==='TRANSACTION_REJECTED');
 const swap=ixs.at(-1),backup=Buffer.from(swap.data);swap.data.writeBigUInt64LE(0n,16);
 assert.throws(()=>auditInstructions(ixs,input,state,quote),e=>e.code==='TRANSACTION_REJECTED');swap.data=backup;
 swap.keys.push({pubkey:OTHER,isSigner:true,isWritable:true});assert.throws(()=>auditInstructions(ixs,input,state,quote),e=>e.code==='TRANSACTION_REJECTED');
});
test('stale blockhash context and missing network fee refuse a build',async()=>{
 for(const failure of ['slot','fee']){
  const f=await fixture();if(failure==='slot'){const original=f.rpc.latestBlockhash;f.rpc.latestBlockhash=async()=>{f.rpc.slot+=100;return original();};}else f.rpc.fee=async()=>null;
  await assert.rejects(()=>trade(buy,ENV,true,()=>f.rpc),e=>e.code===(failure==='slot'?'STALE_STATE':'FEE_UNAVAILABLE'));
 }
});
test('body size, compression, JSON and unknown query reject before RPC',async()=>{
 const app=createService(()=>{throw new Error('Unexpected RPC');});const env={API_KEY:'test'};
 for(const [body,headers,status,suffix] of [['x'.repeat(8193),{},413,''],['{}',{'Content-Encoding':'gzip'},415,''],['{',{},400,''],['{}',{},400,'?unknown=1']]){
  const request=new Request('https://example.com/api/trade/local'+suffix,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json',...headers},body});
  assert.equal((await app.fetch(request,env)).status,status);
 }
});
