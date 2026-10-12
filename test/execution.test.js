import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction,AddressLookupTableAccount,AddressLookupTableProgram} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import bs58 from 'bs58';
import {composeRoute,JUPITER_PROGRAM} from '../src/jupiter.js';
import {FEE_ATA,FEE_RECIPIENT} from '../src/fees.js';
import {tradeInput} from '../src/input.js';
import sdk from '../src/sdk.cjs';
import {MINT,BLOCKHASH,OTHER} from './fixtures.js';
import {executeTrade,trackTrade} from '../examples/execute-trade.mjs';
import {inspectExecution} from '../examples/execution-inspection.mjs';
import {FileTradeJournal} from '../examples/file-journal.mjs';

// Synthetic instructions, ephemeral local signer, completely mocked HTTP/RPC.
// These fixtures cannot execute a protocol trade and never leave this process.
function sample(action='buy',graduated=false,existingWsol=false){
  const wallet=Keypair.generate(),user=wallet.publicKey;
  const order={publicKey:user.toBase58(),mint:MINT.toBase58(),action,amount:action==='buy'?'0.01':'1000',slippageBps:100,maxServiceFeeBps:25,priorityFee:5000};
  const input=tradeInput(order),buy=action==='buy',src=buy?NATIVE_MINT:MINT,dst=buy?MINT:NATIVE_MINT;
  const addresses=[user,getAssociatedTokenAddressSync(src,user),getAssociatedTokenAddressSync(dst,user),src,dst,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,JUPITER_PROGRAM,new PublicKey('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'),JUPITER_PROGRAM,FEE_ATA,graduated?sdk.swap.PUMP_AMM_PROGRAM_ID:sdk.pump.PUMP_PROGRAM_ID,graduated?sdk.pump.canonicalPumpPoolPda(MINT):sdk.pump.bondingCurvePda(MINT),OTHER,SystemProgram.programId];
  const variant=graduated?(buy?193:194):(buy?191:192),fields=variant===191?2:1,data=Buffer.alloc(39+fields);
  Buffer.from('bb64facc31c4af14','hex').copy(data);data.writeBigUInt64LE(input.amount,8);data.writeBigUInt64LE(100000n,16);data.writeUInt16LE(100,24);data.writeUInt16LE(25,26);data.writeUInt32LE(1,30);data[34]=variant;data.writeUInt16LE(10000,35+fields);data[38+fields]=1;
  const instruction=new TransactionInstruction({programId:JUPITER_PROGRAM,keys:addresses.map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:[0,1,2,10,12].includes(i)})),data});
  const built=composeRoute({instruction},input,{tokenProgram:TOKEN_PROGRAM_ID,userBaseTokenAccount:getAssociatedTokenAddressSync(MINT,user)},existingWsol,false,BLOCKHASH,[]);
  const response={...built,unsigned:true,submitted:false,serviceFeeBps:25,feeRecipient:FEE_RECIPIENT.toBase58(),feeAccount:FEE_ATA.toBase58(),feeRouterProgramId:JUPITER_PROGRAM.toBase58(),expectedOut:'100000',minOut:'99000',feeAccountSetupRequired:true,feeAccountSetupRentLamports:'1488440',estimatedNetworkFeeLamports:'10000',blockhash:BLOCKHASH,lastValidBlockHeight:300,simulation:{status:'passed',contextSlot:100}};
  const calls={build:0,sign:0,send:0,status:0,bytes:[]};
  const connection={
    getAccountInfo:async()=>existingWsol?{}:null,
    getBlockHeight:async()=>200,
    getSignatureStatuses:async()=>{calls.status++;return {value:[{confirmationStatus:'confirmed',err:null,slot:105}]};},
    sendRawTransaction:async(bytes,opts)=>{calls.send++;calls.bytes.push(Buffer.from(bytes));assert.equal(opts.skipPreflight,false);assert.equal(opts.maxRetries,2);assert.equal(opts.minContextSlot,100);return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);}
  };
  const settings={baseUrl:'https://test.invalid',connection,rpcTimeoutMs:30,confirmationTimeoutMs:25,pollIntervalMs:1,maxFeeAccountSetupRentLamports:'2000000'};
  let stored;
  const journal={
    reserve:async(id,fingerprint)=>{if(stored){if(fingerprint!==stored.fingerprint)throw new Error('another order');return {created:false,record:structuredClone(stored)};}stored={operationId:id,fingerprint,state:'reserved'};return {created:true,record:structuredClone(stored)};},
    save:async(id,record)=>{stored=structuredClone(record);}
  };
  const signer=async tx=>{calls.sign++;tx.sign([wallet]);return tx;};
  return {wallet,order,response,calls,connection,settings,journal,signer,receipt:()=>stored,options:{operationId:'unique-intent-1',journal,signTransaction:signer}};
}
function mockBuild(t,f){t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(new URL(url).hostname,'test.invalid');assert.equal(JSON.parse(options.body).simulate,true);f.calls.build++;return new Response(JSON.stringify(f.response));});}

for(const action of ['buy','sell'])for(const graduated of [false,true])test(`local execution confirms synthetic ${action} / ${graduated?'pool':'curve'} once`,async t=>{
  const f=sample(action,graduated);mockBuild(t,f);
  const send=f.connection.sendRawTransaction;
  f.connection.sendRawTransaction=async(...args)=>{assert.ok(f.receipt().signature);return send(...args);};
  const result=await executeTrade(f.settings,f.order,f.options);
  assert.equal(result.status,'confirmed');assert.equal(result.acknowledged,true);assert.equal(f.calls.send,1);assert.equal(f.calls.sign,1);
  const second=await executeTrade(f.settings,f.order,f.options);
  assert.equal(second.signature,result.signature);assert.equal(second.status,'confirmed');assert.equal(f.calls.build,1);assert.equal(f.calls.send,1);
  await assert.rejects(()=>executeTrade(f.settings,{...f.order,amount:'1'},f.options),/another order/);
});

test('uncertain send still tracks its original signature, never creates a second trade',async t=>{
  const f=sample();mockBuild(t,f);f.connection.sendRawTransaction=async()=>{f.calls.send++;throw new Error('lost acknowledgement');};
  const result=await executeTrade(f.settings,f.order,f.options);
  assert.equal(result.status,'confirmed');assert.equal(result.acknowledged,false);assert.equal(f.calls.send,1);assert.equal(f.calls.build,1);
});

test('hung submit is bounded and a processed error is not a final failure',async t=>{
  const f=sample();mockBuild(t,f);f.connection.sendRawTransaction=()=>{f.calls.send++;return new Promise(()=>{});};
  f.connection.getSignatureStatuses=async()=>({value:[{confirmationStatus:'processed',err:{InstructionError:[0,'x']}}]});
  const r=await executeTrade({...f.settings,rpcTimeoutMs:5},f.order,f.options);
  assert.equal(r.status,'unknown');assert.ok(r.signature);assert.equal(f.calls.send,1);
});

test('an expired blockhash with missing history remains unknown, including on restart',async t=>{
  const f=sample();mockBuild(t,f);let heights=0;
  f.connection.getBlockHeight=async()=>++heights>2?301:200;
  f.connection.getSignatureStatuses=async()=>({value:[null]});
  const r=await executeTrade(f.settings,f.order,f.options);
  assert.equal(r.status,'unknown');assert.equal(r.blockhashExpired,true);
  const resumed=await executeTrade(f.settings,f.order,f.options);
  assert.equal(resumed.status,'unknown');assert.equal(resumed.signature,r.signature);assert.equal(f.calls.build,1);assert.equal(f.calls.sign,1);
});

test('confirmed program errors report failed, whereas a wrong acknowledgement cannot prove success',async t=>{
  const f=sample();mockBuild(t,f);f.connection.sendRawTransaction=async()=>bs58.encode(new Uint8Array(64).fill(9));
  f.connection.getSignatureStatuses=async()=>({value:[{confirmationStatus:'confirmed',err:{InstructionError:[0,'fixture']}}]});
  const r=await executeTrade(f.settings,f.order,f.options);
  assert.equal(r.status,'failed');assert.equal(r.acknowledged,false);assert.deepEqual(r.error,{InstructionError:[0,'fixture']});
});

test('journal failure prevents broadcasting and a reserved ID never rebuilds',async t=>{
  const f=sample();mockBuild(t,f);f.journal.save=async()=>{throw new Error('disk full');};
  const r=await executeTrade(f.settings,f.order,f.options);
  assert.equal(r.status,'not_submitted');assert.equal(f.calls.send,0);
  const repeat=await executeTrade(f.settings,f.order,f.options);
  assert.equal(repeat.status,'pending');assert.equal(f.calls.build,1);
});

test('rejects signer edits and invalid signatures before submission',async t=>{
  for(const change of ['message','signature']){
    const f=sample();mockBuild(t,f);
    f.options.signTransaction=async tx=>{if(change==='message')tx.message.recentBlockhash=MINT.toBase58();else tx.signatures[0].fill(1);return tx;};
    const r=await executeTrade(f.settings,f.order,f.options);
    assert.equal(r.status,'not_submitted');assert.equal(f.calls.send,0);assert.match(r.reason,/Signer changed|invalid wallet signature/);
  }
});

test('expiry before signing or after slow signing prevents submission',async t=>{
  for(const slow of [false,true]){
    const f=sample();mockBuild(t,f);let calls=0;f.connection.getBlockHeight=async()=>++calls>(slow?1:0)?299:200;
    const r=await executeTrade(f.settings,f.order,f.options);
    assert.equal(r.status,'not_submitted');assert.equal(f.calls.send,0);assert.equal(f.calls.sign,slow?1:0);
  }
});

test('cancel before submission sends nothing; cancellation after send stays unknown',async t=>{
  for(const before of [false,true]){
    const f=sample();mockBuild(t,f);const abort=new AbortController();
    if(before)abort.abort();else f.connection.sendRawTransaction=async()=>{f.calls.send++;abort.abort();throw new Error('cancelled');};
    const r=await executeTrade({...f.settings,signal:abort.signal},f.order,f.options);
    assert.equal(r.status,before?'not_submitted':'unknown');assert.equal(f.calls.send,before?0:1);
  }
});

test('cancellation during the expiry check cannot reach the signer or transport',async t=>{
  const f=sample();mockBuild(t,f);const abort=new AbortController();
  f.connection.getBlockHeight=async()=>{abort.abort();return 200;};
  const r=await executeTrade({...f.settings,signal:abort.signal},f.order,f.options);
  assert.equal(r.status,'not_submitted');assert.equal(f.calls.sign,0);assert.equal(f.calls.send,0);
});

test('fee ceiling, unsuccessful simulation and mismatched build context fail before signing',async t=>{
  const f=sample();mockBuild(t,f);
  await assert.rejects(()=>executeTrade(f.settings,{...f.order,maxServiceFeeBps:10},f.options),e=>e.code==='FEE_LIMIT_EXCEEDED');
  assert.equal(f.calls.build,0);
  for(const modify of [r=>r.simulation.status='failed',r=>r.blockhash=MINT.toBase58()]){
    const g=sample();mockBuild(t,g);modify(g.response);
    const r=await executeTrade(g.settings,g.order,g.options);assert.equal(r.status,'not_submitted');assert.equal(g.calls.sign,0);
  }
});

test('unapproved setup rent or excessive network estimate prevents local signing',async t=>{
  for(const limits of [{maxFeeAccountSetupRentLamports:'0'},{maxNetworkFeeLamports:'5000'}]){
    const f=sample();mockBuild(t,f);
    const r=await executeTrade({...f.settings,...limits},f.order,f.options);
    assert.equal(r.status,'not_submitted');assert.match(r.reason,/cost estimate/);assert.equal(f.calls.sign,0);
  }
});

test('strict inspection rejects extra transfers, unknown programs, altered budgets and existing WSOL cleanup',async()=>{
  const f=sample(),base=VersionedTransaction.deserialize(Buffer.from(f.response.transaction,'base64'));
  for(const attack of ['transfer','program','budget']){
    const decoded=TransactionMessage.decompile(base.message);
    if(attack==='budget')decoded.instructions[0].data[1]++;
    else decoded.instructions.push(attack==='transfer'?SystemProgram.transfer({fromPubkey:f.wallet.publicKey,toPubkey:OTHER,lamports:1}):new TransactionInstruction({programId:OTHER,keys:[],data:Buffer.alloc(0)}));
    const changed=new VersionedTransaction(decoded.compileToV0Message());
    await assert.rejects(()=>inspectExecution({...f.response,transaction:Buffer.from(changed.serialize()).toString('base64')},f.order,f.connection),/Unexpected setup/);
  }
  await assert.rejects(()=>inspectExecution(f.response,f.order,{...f.connection,getAccountInfo:async()=>({})}),/Unexpected setup/);
  const existing=sample('sell',true,true);await inspectExecution(existing.response,existing.order,existing.connection);
});

test('strict lookup resolution validates ownership and activation, reading each table once',async()=>{
  const f=sample(),tx=VersionedTransaction.deserialize(Buffer.from(f.response.transaction,'base64'));
  const addresses=tx.message.staticAccountKeys.slice(1),key=PublicKey.unique();
  const state={deactivationSlot:(1n<<64n)-1n,lastExtendedSlot:90,lastExtendedSlotStartIndex:0,authority:undefined,addresses};
  const table=new AddressLookupTableAccount({key,state}),data=Buffer.alloc(56+32*addresses.length);
  data.writeUInt32LE(1);data.writeBigUInt64LE(state.deactivationSlot,4);data.writeBigUInt64LE(90n,12);
  addresses.forEach((a,i)=>a.toBuffer().copy(data,56+i*32));
  const lookedUp=new VersionedTransaction(TransactionMessage.decompile(tx.message).compileToV0Message([table]));
  const response={...f.response,transaction:Buffer.from(lookedUp.serialize()).toString('base64')};
  let reads=0,owner=AddressLookupTableProgram.programId;
  const connection={getAccountInfo:async k=>{if(k.equals(key)){reads++;return {owner,data,executable:false};}return null;}};
  await inspectExecution(response,f.order,connection);assert.equal(reads,1);
  owner=SystemProgram.programId;await assert.rejects(()=>inspectExecution(response,f.order,connection),/lookup table owner/);
  owner=AddressLookupTableProgram.programId;data.writeBigUInt64LE(100n,12);
  await assert.rejects(()=>inspectExecution(response,f.order,connection),/not active/);
});

test('a hung local signer stops without sending',async t=>{
  const f=sample();mockBuild(t,f);f.options.signTransaction=()=>new Promise(()=>{});
  const result=await executeTrade({...f.settings,signTimeoutMs:5},f.order,f.options);
  assert.equal(result.status,'not_submitted');assert.equal(f.calls.send,0);
});

test('file journal survives new instances, atomically reserves IDs and rejects changed intent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pump-execution-test-'));
  try{
    const a=new FileTradeJournal(root),b=new FileTradeJournal(root);
    const reserved=await a.reserve('intent','hash');assert.equal(reserved.created,true);
    assert.equal((await b.reserve('intent','hash')).created,false);
    await a.save('intent',{...reserved.record,signature:'local-fixture'});
    assert.equal((await b.read('intent')).signature,'local-fixture');
    await assert.rejects(()=>b.reserve('intent','other'),/another order/);
    const races=await Promise.allSettled([a.reserve('racing','same'),b.reserve('racing','same')]);
    assert.equal(races.filter(r=>r.status==='fulfilled'&&r.value.created).length,1);
  }finally{
    assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('pump-execution-test-'));
    await rm(root,{recursive:true,force:true});
  }
});

test('read-only tracker times out a hung provider and rejects malformed receipts',async()=>{
  const f=sample(),record={operationId:'x',signature:bs58.encode(new Uint8Array(64).fill(1)),lastValidBlockHeight:300,contextSlot:100};
  f.connection.getSignatureStatuses=()=>new Promise(()=>{});
  assert.equal((await trackTrade({...f.settings,rpcTimeoutMs:5},record)).status,'unknown');
  await assert.rejects(()=>trackTrade(f.settings,{...record,signature:'bad'}),/Invalid saved/);
  assert.equal(f.calls.send,0);
});
