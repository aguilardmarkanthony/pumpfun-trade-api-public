import test from 'node:test';import assert from 'node:assert/strict';
import {SystemProgram,VersionedTransaction} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {auditRoute,jupiterTrade,JUPITER_PROGRAM,composeRoute,resolveTables} from '../src/jupiter.js';
import {tradeInput} from '../src/input.js';import {loadState} from '../src/protocol.js';import {FEE_ATA,FEE_RECIPIENT,feeFor} from '../src/fees.js';import {fixture,buy,sell,USER,OTHER,BLOCKHASH,tokenInfo} from './fixtures.js';import sdk from '../src/sdk.cjs';import bs58 from 'bs58';import {inspectPublicBuild} from '../examples/client.mjs';
async function sample(graduated=false,action='buy',existingWsol=false){
 const f=await fixture({graduated,existingWsol}),input=tradeInput({...action==='buy'?buy:sell,simulate:true});
 f.accounts.set(JUPITER_PROGRAM.toBase58(),{data:Buffer.alloc(0),owner:SystemProgram.programId,executable:true,lamports:1});
 const state=await loadState(f.rpc,input),isBuy=action==='buy',src=isBuy?NATIVE_MINT:input.mint,dst=isBuy?input.mint:NATIVE_MINT;
 const output=100001n,min=(output*9900n+9999n)/10000n;
 const addresses=[USER,getAssociatedTokenAddressSync(src,USER),getAssociatedTokenAddressSync(dst,USER),src,dst,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,JUPITER_PROGRAM,new (USER.constructor)('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'),JUPITER_PROGRAM,FEE_ATA,graduated?sdk.swap.PUMP_AMM_PROGRAM_ID:sdk.pump.PUMP_PROGRAM_ID,graduated?state.poolKey:state.curveKey,OTHER,SystemProgram.programId];
 const variant=graduated?(isBuy?193:194):(isBuy?191:192),fields=variant===191?2:1,data=Buffer.alloc(39+fields);Buffer.from([187,100,250,204,49,196,175,20]).copy(data);data.writeBigUInt64LE(input.amount,8);data.writeBigUInt64LE(output,16);data.writeUInt16LE(100,24);data.writeUInt16LE(10,26);data.writeUInt32LE(1,30);data[34]=variant;if(variant===191)data[35]=1;data.writeUInt16LE(10000,35+fields);data[38+fields]=1;
 const route={transactionVersion:0,swapMode:'ExactIn',inputMint:src.toBase58(),outputMint:dst.toBase58(),inAmount:input.amount.toString(),outAmount:String(output),otherAmountThreshold:String(min),slippageBps:100,routePlan:[{percent:100,bps:10000,swapInfo:{ammKey:(graduated?state.poolKey:state.curveKey).toBase58(),label:graduated?'Pump.fun Amm':'Pump.fun',inputMint:src.toBase58(),outputMint:dst.toBase58(),inAmount:input.amount.toString(),outAmount:String(output+100n)}}],swapInstruction:{programId:JUPITER_PROGRAM.toBase58(),accounts:addresses.map((p,i)=>({pubkey:p.toBase58(),isSigner:i===0,isWritable:[1,2,10,12].includes(i)})),data:data.toString('base64')},otherInstructions:[],tipInstruction:null,addressesByLookupTableAddress:{}};
 f.rpc.simulate=async tx=>{
 const fee=isBuy?feeFor(input.amount):100n,account=tokenInfo(NATIVE_MINT,FEE_RECIPIENT,fee);
 const message=VersionedTransaction.deserialize(Buffer.from(tx,'base64')).message;
 const index=message.compiledInstructions.findIndex(i=>message.staticAccountKeys[i.programIdIndex].equals(JUPITER_PROGRAM));
 const event=Buffer.alloc(132);Buffer.from('e445a52e51cb9a1d982f4eebc0606e6a','hex').copy(event);event.writeUInt32LE(1,16);src.toBuffer().copy(event,20);event.writeBigUInt64LE(isBuy?input.amount-fee:input.amount,52);dst.toBuffer().copy(event,60);event.writeBigUInt64LE(isBuy?output:100101n,92);addresses[11].toBuffer().copy(event,100);
 const innerInstructions=[{index,instructions:[{programId:JUPITER_PROGRAM.toBase58(),stackHeight:2,data:bs58.encode(event)},{programId:TOKEN_PROGRAM_ID.toBase58(),stackHeight:2,parsed:{type:'transfer',info:{source:getAssociatedTokenAddressSync(NATIVE_MINT,USER).toBase58(),destination:FEE_ATA.toBase58(),authority:USER.toBase58(),amount:fee.toString()}}}]}];
 return {err:null,unitsConsumed:100000,innerInstructions,accounts:[{...account,owner:account.owner.toBase58(),data:[account.data.toString('base64'),'base64']}]};
 };
 return {...f,input,state,route,body:{...action==='buy'?buy:sell,simulate:true},fetcher:async()=>new Response(JSON.stringify(route))};
}
for(const graduated of [false,true])for(const action of ['buy','sell'])test(`Jupiter ${graduated?'AMM':'curve'} ${action} builds a simulated fee-bearing unsigned transaction`,async()=>{
 const f=await sample(graduated,action);const r=await jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher);
 assert.equal(r.serviceFeeBps,10);assert.equal(r.feeRecipient,FEE_RECIPIENT.toBase58());assert.equal(r.feeAsset,'WSOL');assert.equal(r.simulation.status,'passed');assert.equal(r.submitted,false);assert.equal(r.feeAccountSetupRequired,true);assert.ok(BigInt(r.feeAccountSetupRentLamports)>0n);
 await inspectPublicBuild(r,f.body,{});const tx=VersionedTransaction.deserialize(Buffer.from(r.transaction,'base64'));assert.equal(tx.message.header.numRequiredSignatures,1);assert.ok(tx.signatures.every(s=>s.every(b=>b===0)));
 const swap=tx.message.compiledInstructions.find(i=>tx.message.staticAccountKeys[i.programIdIndex].equals(JUPITER_PROGRAM));assert.equal(Buffer.from(swap.data).readUInt16LE(26),10);if(!graduated&&action==='buy')assert.equal(swap.data[35],0);
});
test('Jupiter rejects fee changes, foreign signers, redirected outputs, extra routes and weakened bounds',async()=>{
 const f=await sample();
 const dataChange=(r,offset,value)=>{const d=Buffer.from(r.swapInstruction.data,'base64');d[offset]=value;r.swapInstruction.data=d.toString('base64');};
 const attacks=[r=>dataChange(r,26,0),r=>dataChange(r,28,1),r=>dataChange(r,34,194),r=>dataChange(r,36,1),r=>dataChange(r,24,200),r=>dataChange(r,8,0),r=>dataChange(r,30,2),r=>{r.swapInstruction.accounts[10].pubkey=OTHER.toBase58();},r=>{r.swapInstruction.accounts[2].pubkey=OTHER.toBase58();},r=>{r.swapInstruction.accounts[13].isSigner=true;},r=>{r.routePlan[0].swapInfo.ammKey=OTHER.toBase58();},r=>{r.routePlan.push(r.routePlan[0]);},r=>{r.otherAmountThreshold='1';},r=>{r.tipInstruction={};},r=>{r.otherInstructions=[{}];}];
 for(const attack of attacks){const route=structuredClone(f.route);attack(route);assert.throws(()=>auditRoute(route,f.input,f.state),e=>e.code==='ROUTE_REJECTED');}
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
 const r=await jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher);assert.equal(r.simulation.serviceFeeLamports,'10000');
});
test('sell simulation verifies 0.1% of the actual swap event output',async()=>{
 const f=await sample(false,'sell'),original=f.rpc.simulate;
 f.rpc.simulate=async(...args)=>{const r=await original(...args);r.innerInstructions[0].instructions[1].parsed.info.amount='99';return r;};
 await assert.rejects(()=>jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher),e=>e.code==='ROUTE_REJECTED');
});
test('curve V6 disables partial fills and refuses cashback claims',async()=>{
 const f=await sample(),r=structuredClone(f.route),data=Buffer.from(r.swapInstruction.data,'base64');data[34]=187;data[35]=0;data[36]=1;r.swapInstruction.data=data.toString('base64');
 const audited=auditRoute(r,f.input,f.state);assert.equal(audited.instruction.data[36],0);
 data[35]=1;r.swapInstruction.data=data.toString('base64');assert.throws(()=>auditRoute(r,f.input,f.state),e=>e.code==='ROUTE_REJECTED');
});
test('graduation during simulation refuses an old-venue build',async()=>{
 const f=await sample(),graduated=await fixture({graduated:true}),original=f.rpc.simulate;
 f.rpc.simulate=async(...args)=>{const r=await original(...args);f.accounts.set(f.curveKey.toBase58(),graduated.accounts.get(f.curveKey.toBase58()));f.accounts.set(f.poolKey.toBase58(),graduated.accounts.get(f.poolKey.toBase58()));return r;};
 await assert.rejects(()=>jupiterTrade(f.body,{},true,()=>f.rpc,f.fetcher),e=>e.code==='VENUE_CHANGED');
});
