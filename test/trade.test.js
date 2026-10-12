import test from 'node:test';
import assert from 'node:assert/strict';
import {VersionedTransaction} from '@solana/web3.js';
import {trade,createService} from '../src/service.js';
import {tradeInput,minimumOut} from '../src/input.js';
import {fixture,ENV,buy,sell,USER} from './fixtures.js';
for(const graduated of [false,true])for(const action of ['buy','sell'])for(const cashback of [false,true])test(`${graduated?'PumpSwap':'curve'} ${action} cashback=${cashback}: unsigned, bounded and inspectable`,async()=>{
 const f=await fixture({graduated,cashback});
 const result=await trade(action==='buy'?buy:sell,ENV,true,()=>f.rpc);
 assert.equal(result.venue,graduated?'pumpswap':'pump');assert.equal(result.serviceFeeBps,10);assert.equal(result.feeRecipient,'54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv');
 const tx=VersionedTransaction.deserialize(Buffer.from(result.transaction,'base64'));
 assert.equal(tx.message.header.numRequiredSignatures,1);assert.equal(tx.message.staticAccountKeys[0].toBase58(),USER.toBase58());assert.ok(tx.signatures.every(s=>s.every(b=>b===0)));assert.ok(result.transactionBytes<=1232);assert.ok(BigInt(result.minOut)>0n);
 assert.equal(result.submitted,false);assert.equal(result.lastValidBlockHeight,300);
});
test('negative virtual reserves affect both buy and sell quotes',async()=>{
 for(const input of [buy,sell]){
  const a=await fixture({graduated:true}),b=await fixture({graduated:true,virtualQuote:'-10000000000'});
  const q1=await trade(input,{},false,()=>a.rpc),q2=await trade(input,{},false,()=>b.rpc);
  assert.ok(input.action==='buy'?BigInt(q2.quotedOut)>BigInt(q1.quotedOut):BigInt(q2.quotedOut)<BigInt(q1.quotedOut));
 }
});
test('existing WSOL account remains open and output asset is explicit',async()=>{
 const f=await fixture({graduated:true,existingWsol:true});const result=await trade(sell,ENV,true,()=>f.rpc);
 assert.equal(result.outputAsset,'WSOL');assert.equal(result.existingWsolAccountPreserved,true);assert.ok(!result.instructionSummary.some(i=>i.operation==='unwrap_new_wsol_account'));
});
test('simulation failure refuses to return a transaction',async()=>{
 const f=await fixture();f.rpc.simulate=async()=>({err:{InstructionError:[1,'Custom']}});
 await assert.rejects(()=>trade({...buy,simulate:true},ENV,true,()=>f.rpc),e=>e.code==='SIMULATION_FAILED');
});
test('a simulation response missing err cannot claim success',async()=>{
 const f=await fixture();f.rpc.simulate=async()=>({unitsConsumed:70000});
 await assert.rejects(()=>trade({...buy,simulate:true},ENV,true,()=>f.rpc),e=>e.code==='SIMULATION_FAILED');
});
test('simulation is on by default and success is recorded',async()=>{
 const f=await fixture();const {simulate,...input}=buy;const r=await trade(input,ENV,true,()=>f.rpc);assert.equal(r.simulation.status,'passed');
});
test('zero RPC work for invalid amounts, fields and slippage',async()=>{
 const bad=[{amount:'1e6'},{amount:'0'},{amount:'-1'},{amount:'101'},{amount:'0.0000000001'},{slippage:0},{slippage:51},{slippageBps:1,slippage:1},{denominatedInSol:false},{privateKey:'never accepted'},{simulate:'false'},{publicKey:'11111111111111111111111111111111'},{pool:'raydium'}];
 for(const part of bad)await assert.rejects(()=>trade({...buy,...part},ENV,true,()=>{throw new Error('RPC must not be constructed');}),e=>e.code==='INVALID_INPUT'||e.code==='UNSUPPORTED_VENUE');
});
test('integer-string precision and raw-unit sell semantics',()=>{
 assert.equal(tradeInput({...sell,amount:'9007199254740993'}).amount,9007199254740993n);
 assert.throws(()=>tradeInput({...sell,amount:9007199254740993}));assert.equal(tradeInput({...buy,amount:0.01}).amount,10000000n);
 assert.equal(minimumOut(1000000001n,101),989900000n);
});
test('venue mismatch and incomplete migration fail explicitly',async()=>{
 let f=await fixture();await assert.rejects(()=>trade({...buy,pool:'pumpswap'},{},false,()=>f.rpc),e=>e.code==='VENUE_CHANGED');
 f=await fixture({graduated:true});f.accounts.delete(f.poolKey.toBase58());await assert.rejects(()=>trade(buy,{},false,()=>f.rpc),e=>e.code==='MIGRATION_PENDING');
});
test('insufficient token balance is rejected before building',async()=>{
 const f=await fixture();await assert.rejects(()=>trade({...sell,amount:'600000000000'},ENV,true,()=>f.rpc),e=>e.code==='INSUFFICIENT_TOKEN_BALANCE');
});
test('origin authentication fails closed; health exposes no RPC secret',async()=>{
 const app=createService(()=>{throw new Error('Unexpected RPC');});
 assert.equal((await app.fetch(new Request('https://example.com/api/capabilities'),{})).status,503);
 assert.equal((await app.fetch(new Request('https://example.com/api/capabilities'),{API_KEY:'test'})).status,401);
 const r=await app.fetch(new Request('https://example.com/api/health'),{SOLANA_RPC_URL:'https://example.com/private'});assert.equal(r.status,200);assert.ok(!(await r.text()).includes('private'));
});
