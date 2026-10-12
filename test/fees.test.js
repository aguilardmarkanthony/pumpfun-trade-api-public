import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey, SystemProgram, SystemInstruction, VersionedTransaction} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,NATIVE_MINT} from '@solana/spl-token';
import sdk from '../src/sdk.cjs';
import {feeFor,FEE_RECIPIENT,FEE_ATA,wrapWithFee,routerConfig} from '../src/fees.js';
import {trade} from '../src/service.js';
import {loadState,quoteState,instructions} from '../src/protocol.js';
import {tradeInput} from '../src/input.js';
import {fixture,buy,sell,ENV,ROUTER,USER} from './fixtures.js';

test('integer fees are 10 bps, rounded down, without floating point',()=>{
  for(const [amount,fee] of [[0n,0n],[999n,0n],[1000n,1n],[1000000000n,1000000n],[(1n<<64n)-1n,18446744073709551n]]) assert.equal(feeFor(amount),fee);
});

test('missing router never silently falls back to an uncharged transaction',async()=>{
  await assert.rejects(()=>trade(buy,{},true,()=>{throw new Error('Must not call RPC');}),e=>e.code==='FEE_ROUTER_NOT_DEPLOYED');
  const f=await fixture();f.accounts.delete(ROUTER.toBase58());
  await assert.rejects(()=>trade(buy,ENV,true,()=>f.rpc),e=>e.code==='FEE_ROUTER_NOT_DEPLOYED');
  assert.throws(()=>routerConfig({FEE_ROUTER_PROGRAM_ID:SystemProgram.programId.toBase58()},true),e=>e.code==='INVALID_ROUTER_CONFIG');
});

test('public input cannot override the recipient, rate or router',async()=>{
  for(const field of ['feeRecipient','serviceFeeBps','feeRouterProgramId']) await assert.rejects(()=>trade({...buy,[field]:'anything'},ENV,true),e=>e.code==='INVALID_INPUT');
});

test('uninitialized native fee recipient fails with an operator setup error',async()=>{
  const f=await fixture();f.accounts.delete(FEE_RECIPIENT.toBase58());
  await assert.rejects(()=>trade(buy,ENV,true,()=>f.rpc),e=>e.code==='FEE_RECIPIENT_NOT_READY');
});

for(const graduated of [false,true])for(const action of ['buy','sell'])test(`fee wrapper ${graduated?'AMM':'curve'} ${action} binds recipient, stage and original instruction`,async()=>{
  const f=await fixture({graduated}),input=tradeInput(action==='buy'?buy:sell),state=await loadState(f.rpc,input,ROUTER),quote=quoteState(state,input);
  const original=await instructions(state,input,quote),wrapped=wrapWithFee(original,input,state,quote,ROUTER);
  const outer=wrapped.find(ix=>ix.programId.equals(ROUTER));
  assert.equal(outer.keys[1].pubkey.toBase58(),FEE_RECIPIENT.toBase58());
  assert.equal(outer.keys[2].pubkey.toBase58(),state.curveKey.toBase58());
  assert.equal(outer.keys[5].pubkey.toBase58(),(graduated?FEE_ATA:FEE_RECIPIENT).toBase58());
  assert.deepEqual([...outer.data.subarray(0,3)],[1,graduated?1:0,action==='buy'?0:1]);
  const originalTrade=original.find(ix=>ix.programId.equals(graduated?sdk.swap.PUMP_AMM_PROGRAM_ID:sdk.pump.PUMP_PROGRAM_ID));
  assert.deepEqual(outer.data.subarray(4+outer.data[3]),originalTrade.data);
  if(graduated&&action==='buy'){
    const t=SystemInstruction.decodeTransfer(wrapped.find(ix=>ix.programId.equals(SystemProgram.programId)));
    assert.equal(t.lamports,input.amount+feeFor(input.amount));
    assert.ok(t.toPubkey.equals(getAssociatedTokenAddressSync(NATIVE_MINT,USER)));
  }
});

test('sell response separates gross slippage minimum from net minimum after the fee',async()=>{
  const f=await fixture({graduated:true});const q=await trade(sell,{},false,()=>f.rpc);
  assert.equal(q.minNetOut,(BigInt(q.minOut)-feeFor(BigInt(q.minOut))).toString());
  assert.equal(q.expectedNetOut,(BigInt(q.expectedOut)-feeFor(BigInt(q.expectedOut))).toString());
  assert.equal(q.feeAsset,'WSOL');assert.equal(q.feeEstimateIsFinal,false);assert.equal(q.feeLamports,undefined);
});

test('buy funding check reserves the service fee in addition to input and network fee',async()=>{
  const f=await fixture();f.accounts.get(USER.toBase58()).lamports=10005000;
  await assert.rejects(()=>trade(buy,ENV,true,()=>f.rpc),e=>e.code==='INSUFFICIENT_SOL_BALANCE');
});

test('new curve volume account is initialized outside the measured trade',async()=>{
  const f=await fixture();f.accounts.delete(sdk.pump.userVolumeAccumulatorPda(USER).toBase58());
  const r=await trade(buy,ENV,true,()=>f.rpc);
  assert.equal(r.instructionSummary[0].operation,'initialize_volume_account_before_fee_measurement');
  assert.ok(r.transactionBytes<=1232);
});

test('graduation between discovery and pricing snapshots requires a rebuild',async()=>{
  const before=await fixture(),after=await fixture({graduated:true});
  const original=before.rpc.accounts;let n=0;
  before.rpc.accounts=async keys=>++n===1?original(keys):after.rpc.accounts(keys);
  await assert.rejects(()=>trade(buy,ENV,true,()=>before.rpc),e=>e.code==='VENUE_CHANGED');
});

test('there is one unsigned fee wrapper in the final serialized transaction',async()=>{
  const f=await fixture();const r=await trade({...buy,simulate:true},ENV,true,()=>f.rpc);
  const tx=VersionedTransaction.deserialize(Buffer.from(r.transaction,'base64'));
  assert.equal(tx.message.compiledInstructions.filter(ix=>tx.message.staticAccountKeys[ix.programIdIndex].equals(ROUTER)).length,1);
  assert.ok(tx.signatures.every(s=>s.every(b=>b===0)));
});
