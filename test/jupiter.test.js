import test from 'node:test';import assert from 'node:assert/strict';
import {inspectExecution} from '../examples/execution-inspection.mjs';
import {PublicKey,SystemProgram,VersionedTransaction} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {auditRoute,jupiterTrade,JUPITER_PROGRAM,composeRoute,resolveTables} from '../src/jupiter.js';
import {tradeInput} from '../src/input.js';import {loadState} from '../src/protocol.js';import {FEE_ATA,FEE_RECIPIENT,feeFor} from '../src/fees.js';import {fixture,buy,sell,USER,OTHER,BLOCKHASH,tokenInfo} from './fixtures.js';import sdk from '../src/sdk.cjs';import bs58 from 'bs58';import {inspectPublicBuild} from '../examples/client.mjs';
async function sample(graduated=false,action='buy',existingWsol=false){
 const f=await fixture({graduated,existingWsol}),input=tradeInput({...action==='buy'?buy:sell,simulate:true});
 f.accounts.set(JUPITER_PROGRAM.toBase58(),{data:Buffer.alloc(0),owner:SystemProgram.programId,executable:true,lamports:1});
 const state=await loadState(f.rpc,input),isBuy=action==='buy',src=isBuy?NATIVE_MINT:input.mint,dst=isBuy?input.mint:NATIVE_MINT;
 const output=isBuy?100001n:99851n,min=(output*9900n+9999n)/10000n;
 const addresses=[USER,getAssociatedTokenAddressSync(src,USER),getAssociatedTokenAddressSync(dst,USER),src,dst,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,JUPITER_PROGRAM,new (USER.constructor)('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'),JUPITER_PROGRAM,FEE_ATA,graduated?sdk.swap.PUMP_AMM_PROGRAM_ID:sdk.pump.PUMP_PROGRAM_ID,graduated?state.poolKey:state.curveKey,OTHER,SystemProgram.programId];
 if(!graduated){addresses[12]=OTHER;while(addresses.length<=17)addresses.push(OTHER);addresses[17]=state.curveKey;}
 const variant=graduated?(isBuy?193:194):(isBuy?191:192),fields=variant===191?2:1,data=Buffer.alloc(39+fields);Buffer.from([187,100,250,204,49,196,175,20]).copy(data);data.writeBigUInt64LE(input.amount,8);data.writeBigUInt64LE(output,16);data.writeUInt16LE(100,24);data.writeUInt16LE(25,26);data.writeUInt32LE(1,30);data[34]=variant;if(variant===191)data[35]=1;data.writeUInt16LE(10000,35+fields);data[38+fields]=1;
 const route={transactionVersion:0,swapMode:'ExactIn',inputMint:src.toBase58(),outputMint:dst.toBase58(),inAmount:input.amount.toString(),outAmount:String(output),otherAmountThreshold:String(min),slippageBps:100,routePlan:[{percent:100,bps:10000,swapInfo:{ammKey:(graduated?state.poolKey:state.curveKey).toBase58(),label:graduated?'Pump.fun Amm':'Pump.fun',inputMint:src.toBase58(),outputMint:dst.toBase58(),inAmount:input.amount.toString(),outAmount:String(isBuy?output:100101n)}}],swapInstruction:{programId:JUPITER_PROGRAM.toBase58(),accounts:addresses.map((p,i)=>({pubkey:p.toBase58(),isSigner:i===0,isWritable:[1,2,10].includes(i)||i===(graduated?12:17)})),data:data.toString('base64')},otherInstructions:[],tipInstruction:null,addressesByLookupTableAddress:{}};
 f.rpc.simulate=async tx=>{
 const fee=isBuy?feeFor(input.amount):250n,account=tokenInfo(NATIVE_MINT,FEE_RECIPIENT,fee);
 const message=VersionedTransaction.deserialize(Buffer.from(tx,'base64')).message;
 const index=message.compiledInstructions.findIndex(i=>message.staticAccountKeys[i.programIdIndex].equals(JUPITER_PROGRAM));
 const event=Buffer.alloc(132);Buffer.from('e445a52e51cb9a1d982f4eebc0606e6a','hex').copy(event);event.writeUInt32LE(1,16);src.toBuffer().copy(event,20);event.writeBigUInt64LE(isBuy?input.amount-fee:input.amount,52);dst.toBuffer().copy(event,60);event.writeBigUInt64LE(isBuy?output:100101n,92);addresses[11].toBuffer().copy(event,100);
 const innerInstructions=[{index,instructions:[{programId:JUPITER_PROGRAM.toBase58(),stackHeight:2,data:bs58.encode(event)},{programId:TOKEN_PROGRAM_ID.toBase58(),stackHeight:2,parsed:{type:'transfer',info:{source:getAssociatedTokenAddressSync(NATIVE_MINT,USER).toBase58(),destination:FEE_ATA.toBase58(),authority:USER.toBase58(),amount:fee.toString()}}}]}];
 return {err:null,unitsConsumed:100000,innerInstructions,accounts:[{...account,owner:account.owner.toBase58(),data:[account.data.toString('base64'),'base64']}]};
 };
 return {...f,input,state,route,body:{...action==='buy'?buy:sell,simulate:true},fetcher:async()=>new Response(JSON.stringify(route))};
}
for(const graduated of [false,true])for(const action of ['buy','sell'])test(`Jupiter ${graduated?'AMM':'curve'} ${action} builds a simulated fee-bearing unsigned transaction`,async()=>{
 const f=await sample(graduated,action);f.body.maxServiceFeeBps=25;const r=await jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher);
 assert.equal(r.serviceFeeBps,25);assert.equal(r.feeRecipient,FEE_RECIPIENT.toBase58());assert.equal(r.feeAsset,'WSOL');assert.equal(r.simulation.status,'passed');assert.equal(r.submitted,false);assert.equal(r.feeAccountSetupRequired,true);assert.ok(BigInt(r.feeAccountSetupRentLamports)>0n);
 await inspectPublicBuild(r,f.body,{});await inspectExecution(r,f.body,{getAccountInfo:async()=>null});const tx=VersionedTransaction.deserialize(Buffer.from(r.transaction,'base64'));assert.equal(tx.message.header.numRequiredSignatures,1);assert.ok(tx.signatures.every(s=>s.every(b=>b===0)));
 const swap=tx.message.compiledInstructions.find(i=>tx.message.staticAccountKeys[i.programIdIndex].equals(JUPITER_PROGRAM));assert.equal(Buffer.from(swap.data).readUInt16LE(26),25);if(!graduated&&action==='buy')assert.equal(swap.data[35],0);
});
test('Jupiter rejects fee changes, foreign signers, redirected outputs, extra routes and weakened bounds',async()=>{
 const f=await sample();
 const dataChange=(r,offset,value)=>{const d=Buffer.from(r.swapInstruction.data,'base64');d[offset]=value;r.swapInstruction.data=d.toString('base64');};
 const attacks=[r=>dataChange(r,26,0),r=>dataChange(r,28,1),r=>dataChange(r,34,194),r=>dataChange(r,36,1),r=>dataChange(r,24,200),r=>dataChange(r,8,0),r=>dataChange(r,30,2),r=>{r.swapInstruction.accounts[10].pubkey=OTHER.toBase58();},r=>{r.swapInstruction.accounts[2].pubkey=OTHER.toBase58();},r=>{r.swapInstruction.accounts[13].isSigner=true;},r=>{r.routePlan[0].swapInfo.ammKey=OTHER.toBase58();},r=>{r.routePlan.push(r.routePlan[0]);},r=>{r.otherAmountThreshold='1';},r=>{r.tipInstruction={};},r=>{r.otherInstructions=[{}];}];
 for(const attack of attacks){const route=structuredClone(f.route);attack(route);assert.throws(()=>auditRoute(route,f.input,f.state),e=>e.code==='ROUTE_REJECTED');}
});

test('upstream requests use 25 bps and stale 10-bps routes cannot be returned',async()=>{
 const f=await sample();
 const fetcher=async url=>{assert.equal(new URL(url).searchParams.get('platformFeeBps'),'25');return f.fetcher();};
 await jupiterTrade({...f.body,maxServiceFeeBps:25},{},false,()=>f.rpc,fetcher);
 const data=Buffer.from(f.route.swapInstruction.data,'base64');data.writeUInt16LE(10,26);f.route.swapInstruction.data=data.toString('base64');
 await assert.rejects(()=>jupiterTrade(f.body,{},false,()=>f.rpc,fetcher),e=>e.code==='ROUTE_REJECTED');
});

test('fee and router accounts share the pricing snapshot, removing a separate RPC round trip',async()=>{
 for(const graduated of [false,true]){
  const f=await sample(graduated),reads=[],original=f.rpc.accounts;
  f.rpc.accounts=async keys=>{reads.push(keys.map(k=>k.toBase58()));return original(keys);};
  await jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher);
  assert.equal(reads.length,3); // Discovery, pricing/setup snapshot, final stage recheck.
  for(const key of [FEE_ATA,JUPITER_PROGRAM,USER,f.input.mint])assert.ok(reads[1].includes(key.toBase58()));
 }
});

test('client inspection rejects a lower fee ceiling and misleading output amounts',async()=>{
 const f=await sample(),r=await jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher);
 await assert.rejects(()=>inspectPublicBuild(r,{...f.body,maxServiceFeeBps:10},{}),e=>e.code==='FEE_LIMIT_EXCEEDED');
 for(const field of ['expectedOut','minOut'])await assert.rejects(()=>inspectPublicBuild({...r,[field]:'999999999'},f.body,{}),/output bounds/);
 const tx=VersionedTransaction.deserialize(Buffer.from(r.transaction,'base64'));
 const swap=tx.message.compiledInstructions.find(ix=>tx.message.staticAccountKeys[ix.programIdIndex].equals(JUPITER_PROGRAM));
 const data=Buffer.from(swap.data);data.writeUInt16LE(10,26);swap.data=data;
 await assert.rejects(()=>inspectPublicBuild({...r,transaction:Buffer.from(tx.serialize()).toString('base64')},f.body,{}),/fee or route/);
});
test('Jupiter ignores upstream setup transfers and preserves existing WSOL',async()=>{
 const f=await sample(true,'buy',true);f.route.setupInstructions=[{programId:SystemProgram.programId.toBase58(),data:'unexpected transfer'}];
 const audited=auditRoute(f.route,f.input,f.state),built=composeRoute(audited,f.input,f.state,true,false,BLOCKHASH,[]),tx=VersionedTransaction.deserialize(Buffer.from(built.transaction,'base64'));
 const close=tx.message.compiledInstructions.filter(ix=>tx.message.staticAccountKeys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID)&&ix.data[0]===9);assert.equal(close.length,0);
});
test('Jupiter refuses missing fee simulation, wrong buy fee, program absence and failed simulation',async()=>{
 for(const failure of ['accounts','fee','err','program']){
  const f=await sample();if(failure==='program')f.accounts.delete(JUPITER_PROGRAM.toBase58());
  else{const original=f.rpc.simulate;f.rpc.simulate=async(...args)=>{const result=await original(...args);if(failure==='accounts')delete result.accounts;if(failure==='err')result.err={InstructionError:[1,'failure']};if(failure==='fee'){result.innerInstructions[0].instructions[1].parsed.info.amount='1';}return result;};}
  await assert.rejects(()=>jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher));
 }
});
test('Jupiter simulation cannot be disabled and invalid input performs no network work',async()=>{
 await assert.rejects(()=>jupiterTrade(buy,{},true,()=>{throw new Error('Unexpected RPC');}),e=>e.code==='SIMULATION_REQUIRED');
 await assert.rejects(()=>jupiterTrade({...buy,amount:'-1'}, {},false,()=>{throw new Error('Unexpected RPC');}),e=>e.code==='INVALID_INPUT');
});
test('Jupiter lookup tables must be read from chain and validated',async()=>{
 const f=await sample();f.route.addressesByLookupTableAddress={[OTHER.toBase58()]:[]};await assert.rejects(()=>resolveTables(f.route,f.rpc),e=>e.code==='ROUTE_REJECTED');
});
test('Jupiter fetch errors never return upstream URLs or credentials',async()=>{
 const f=await sample();await assert.rejects(()=>jupiterTrade(f.body,{JUPITER_API_KEY:'secret'},true,()=>f.rpc,async()=>{throw new Error('secret');}),e=>e.code==='ROUTE_UNAVAILABLE'&&!e.message.includes('secret'));
});
test('unrelated recipient deposits do not contaminate the simulated trade fee',async()=>{
 const f=await sample(),original=f.rpc.simulate;
 f.rpc.simulate=async(...args)=>{const r=await original(...args),a=r.accounts[0],data=Buffer.from(a.data[0],'base64');data.writeBigUInt64LE(5000000n,64);a.data[0]=data.toString('base64');a.lamports=6488440;return r;};
 const r=await jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher);assert.equal(r.simulation.serviceFeeLamports,'25000');
});
test('sell simulation verifies 0.25% of the actual swap event output',async()=>{
 const f=await sample(false,'sell'),original=f.rpc.simulate;
 f.rpc.simulate=async(...args)=>{const r=await original(...args);r.innerInstructions[0].instructions[1].parsed.info.amount='99';return r;};
 await assert.rejects(()=>jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher),e=>e.code==='ROUTE_REJECTED');
});
test('curve V6 disables partial fills and refuses cashback claims',async()=>{
 const f=await sample(),r=structuredClone(f.route),data=Buffer.from(r.swapInstruction.data,'base64');data[34]=187;data[35]=0;data[36]=1;const pool=r.swapInstruction.accounts[17];r.swapInstruction.accounts[17]={...pool,pubkey:OTHER.toBase58()};while(r.swapInstruction.accounts.length<=22)r.swapInstruction.accounts.push({...pool,pubkey:OTHER.toBase58()});r.swapInstruction.accounts[22]=pool;r.swapInstruction.data=data.toString('base64');
 const audited=auditRoute(r,f.input,f.state);assert.equal(audited.instruction.data[36],0);
 data[35]=1;r.swapInstruction.data=data.toString('base64');assert.throws(()=>auditRoute(r,f.input,f.state),e=>e.code==='ROUTE_REJECTED');
});
test('graduation during simulation refuses an old-venue build',async()=>{
 const f=await sample(),graduated=await fixture({graduated:true}),original=f.rpc.simulate;
 f.rpc.simulate=async(...args)=>{const r=await original(...args);f.accounts.set(f.curveKey.toBase58(),graduated.accounts.get(f.curveKey.toBase58()));f.accounts.set(f.poolKey.toBase58(),graduated.accounts.get(f.poolKey.toBase58()));return r;};
 await assert.rejects(()=>jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher),e=>e.code==='VENUE_CHANGED');
});

test('customer RPC client builds both directions at both stages without an APILabPH request',async()=>{
 const {createClient}=await import('../client/index.mjs');
 const rpcUrl='https://customer-rpc.example/?key=customer-rpc-fixture';
 for(const graduated of [false,true])for(const action of ['buy','sell']){
  const f=await sample(graduated,action),seen=[];
  const client=createClient({rpcUrl,jupiterApiKey:'customer-routing-fixture',fetchImpl:async(url,options)=>{
   seen.push(String(url));
   if(new URL(url).hostname==='api.jup.ag'){
    assert.equal(options.headers['x-api-key'],'customer-routing-fixture');
    assert.ok(!String(url).includes('customer-rpc-fixture'));
    return f.fetcher();
   }
   assert.equal(url,rpcUrl);assert.equal(options.headers['x-api-key'],undefined);
   const {id,method,params}=JSON.parse(options.body);let value;
   if(method==='getMultipleAccounts')value=(await f.rpc.accounts(params[0].map(key=>new PublicKey(key)))).map(a=>a===null?null:{...a,owner:a.owner.toBase58(),data:[a.data.toString('base64'),'base64']});
   else if(method==='getLatestBlockhash')value=await f.rpc.latestBlockhash();
   else if(method==='getFeeForMessage')value=await f.rpc.fee(params[0]);
   else if(method==='simulateTransaction')value=await f.rpc.simulate(params[0]);
   else throw Error('Unexpected RPC method '+method);
   return Response.json({jsonrpc:'2.0',id,result:{context:{slot:f.rpc.slot},value}});
  }});
  const result=await client.buildTrade({...f.body,maxServiceFeeBps:25});
  assert.equal(result.simulation.status,'passed');assert.equal(result.submitted,false);assert.equal(result.serviceFeeBps,25);
  assert.equal(result.feeRecipient,FEE_RECIPIENT.toBase58());
  assert.ok(seen.some(url=>url===rpcUrl));assert.ok(seen.some(url=>new URL(url).hostname==='api.jup.ag'));
  assert.ok(!JSON.stringify(result).includes('customer-rpc-fixture'));
 }
});

for(const graduated of [false,true])for(const action of ['buy','sell'])test('route rejects an expected market appended outside the '+(graduated?'pool':'curve')+' account position / '+action,async()=>{
 const f=await sample(graduated,action),route=structuredClone(f.route),index=graduated?12:17;
 route.swapInstruction.accounts.push({...route.swapInstruction.accounts[index]});
 route.swapInstruction.accounts[index].pubkey=OTHER.toBase58();
 assert.throws(()=>auditRoute(route,f.input,f.state),e=>e.code==='ROUTE_REJECTED');
});
for(const graduated of [false,true])test('both local inspectors reject a misplaced '+(graduated?'pool':'curve')+' account before signing',async()=>{
 const f=await sample(graduated),audited=auditRoute(f.route,f.input,f.state);
 const result=await jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher),index=graduated?12:17;
 audited.instruction.keys.push({...audited.instruction.keys[index]});
 audited.instruction.keys[index]={...audited.instruction.keys[index],pubkey:OTHER};
 const altered=composeRoute(audited,f.input,f.state,false,false,BLOCKHASH,[]);
 const response={...result,transaction:altered.transaction};
 await assert.rejects(()=>inspectPublicBuild(response,f.body,{}),/market|protocol/);
 await assert.rejects(()=>inspectExecution(response,f.body,{getAccountInfo:async()=>null}),/market|protocol/);
});

test('pinned market positions match saved public route layout evidence',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {PUMP_MARKET_INDEX}=await import('../src/jupiter.js');
 const evidence=JSON.parse(await readFile(new URL('./fixtures/jupiter-market-layouts.json',import.meta.url),'utf8'));
 for(const layout of evidence.layouts)assert.equal(PUMP_MARKET_INDEX[layout.variant],layout.marketIndex);
 assert.equal(PUMP_MARKET_INDEX[153],undefined,'Unverified legacy sell layout must not be guessed');
 const f=await sample(false,'sell'),data=Buffer.from(f.route.swapInstruction.data,'base64');
 data[34]=153;f.route.swapInstruction.data=data.toString('base64');
 assert.throws(()=>auditRoute(f.route,f.input,f.state),e=>e.code==='ROUTE_REJECTED');
});
