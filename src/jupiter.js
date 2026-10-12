import {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,ComputeBudgetProgram,AddressLookupTableAccount,AddressLookupTableProgram,SystemProgram} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,createSyncNativeInstruction,createCloseAccountInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import sdk from './sdk.cjs';
import bs58 from 'bs58';
import {ApiError,boundedText} from './http.js';
import {tradeInput,U64_MAX} from './input.js';
import {loadState,quoteState,tokenAccount,chooseRoute,owned} from './protocol.js';
import {Rpc} from './rpc.js';
import {FEE_RECIPIENT,FEE_ATA,FEE_BPS,feeFor} from './fees.js';

export const JUPITER_PROGRAM=new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const EVENT_AUTHORITY=new PublicKey('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf');
const DISCRIMINATOR=Buffer.from([187,100,250,204,49,196,175,20]);
const COMPUTE_UNITS=400000;
const reject=()=>{throw new ApiError(502,'ROUTE_REJECTED','The upstream route did not pass transaction safety checks. No transaction was submitted.');};
function uint(value){if(typeof value!=='string'||!/^\d{1,20}$/.test(value)||BigInt(value)>U64_MAX)reject();return BigInt(value);}
const key=value=>{try{return new PublicKey(value);}catch{reject();}};
const same=(a,b)=>typeof a==='string'&&a===b.toBase58();

export async function fetchRoute(input,state,env,fetcher=fetch){
  const buy=input.action==='buy';
  const params=new URLSearchParams({inputMint:(buy?NATIVE_MINT:input.mint).toBase58(),outputMint:(buy?input.mint:NATIVE_MINT).toBase58(),amount:input.amount.toString(),taker:input.user.toBase58(),slippageBps:String(input.slippageBps),platformFeeBps:String(FEE_BPS),feeAccount:FEE_ATA.toBase58(),dexes:state.venue==='pump'?'Pump.fun':'Pump.fun Amm',transactionVersion:'0'});
  try{
    const response=await fetcher.call(globalThis,'https://api.jup.ag/swap/v2/build?'+params,{headers:env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{},redirect:'manual',signal:AbortSignal.timeout(7000)});
    if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error();}
    return JSON.parse(await boundedText(response.body,262144,7000));
  }catch{throw new ApiError(503,'ROUTE_UNAVAILABLE','The routing service could not build this market right now. Retry later; newly created tokens may not be indexed yet.');}
}

// Narrow route_v2 decoder. ABI checked against Jupiter's mainnet-published Anchor
// IDL on 2026-10-13. Unknown variants fail closed; no arbitrary upstream execution.
export function auditRoute(route,input,state){
  const buy=input.action==='buy',sourceMint=buy?NATIVE_MINT:input.mint,destMint=buy?input.mint:NATIVE_MINT;
  const sourceProgram=buy?TOKEN_PROGRAM_ID:state.tokenProgram,destProgram=buy?state.tokenProgram:TOKEN_PROGRAM_ID;
  const source=getAssociatedTokenAddressSync(sourceMint,input.user,false,sourceProgram),destination=getAssociatedTokenAddressSync(destMint,input.user,false,destProgram);
  if(!route||route.transactionVersion!==0||route.swapMode!=='ExactIn'||!same(route.inputMint,sourceMint)||!same(route.outputMint,destMint)||uint(route.inAmount)!==input.amount||route.slippageBps!==input.slippageBps)reject();
  const output=uint(route.outAmount),min=uint(route.otherAmountThreshold);
  if(output===0n||min===0n||min!==(output*BigInt(10000-input.slippageBps)+9999n)/10000n)reject();
  const plan=route.routePlan;
  if(!Array.isArray(plan)||plan.length!==1||plan[0].bps!==10000||plan[0].percent!==100)reject();
  const info=plan[0].swapInfo,market=state.venue==='pump'?state.curveKey:state.poolKey;
  if(!info||info.label!==(state.venue==='pump'?'Pump.fun':'Pump.fun Amm')||!same(info.ammKey,market)||!same(info.inputMint,sourceMint)||!same(info.outputMint,destMint)||uint(info.inAmount)!==input.amount||uint(info.outAmount)===0n)reject();
  if(route.tipInstruction||!Array.isArray(route.otherInstructions)||route.otherInstructions.length)reject();
  const raw=route.swapInstruction;
  if(!raw||!same(raw.programId,JUPITER_PROGRAM)||!Array.isArray(raw.accounts)||raw.accounts.length<15||raw.accounts.length>64||typeof raw.data!=='string'||raw.data.length>128||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.data))reject();
  const data=Buffer.from(raw.data,'base64');
  const variants=state.venue==='pump'?(buy?[187,191]:[153,192]):(buy?[193]:[194]);
  const variant=data[34],fields=[187,191].includes(variant)?2:1;
  if(!variants.includes(variant)||data.length!==39+fields||!data.subarray(0,8).equals(DISCRIMINATOR)||data.readBigUInt64LE(8)!==input.amount||data.readBigUInt64LE(16)!==output||data.readUInt16LE(24)!==input.slippageBps||data.readUInt16LE(26)!==FEE_BPS||data.readUInt16LE(28)!==0||data.readUInt32LE(30)!==1)reject();
  const partialOffset=variant===191?35:variant===187?36:null;
  for(let n=35;n<35+fields;n++)if(data[n]>(n===partialOffset?1:0))reject();
  if(data.readUInt16LE(35+fields)!==10000||data[37+fields]!==0||data[38+fields]!==1)reject();
  // A partial curve fill would charge against a larger requested SOL input.
  // Tighten the instruction to require a full fill. Never enable partial fills.
  if(partialOffset!==null)data[partialOffset]=0;
  const accounts=raw.accounts.map(a=>{if(typeof a.isSigner!=='boolean'||typeof a.isWritable!=='boolean')reject();const pubkey=key(a.pubkey);if(a.isSigner&&!pubkey.equals(input.user))reject();return {...a,pubkey};});
  const expected=[input.user,source,destination,sourceMint,destMint,sourceProgram,destProgram,JUPITER_PROGRAM,EVENT_AUTHORITY,JUPITER_PROGRAM,FEE_ATA,state.venue==='pump'?sdk.pump.PUMP_PROGRAM_ID:sdk.swap.PUMP_AMM_PROGRAM_ID];
  if(expected.some((p,i)=>!accounts[i].pubkey.equals(p))||!accounts[0].isSigner||![1,2,10].every(i=>accounts[i].isWritable)||!accounts.slice(12).some(a=>a.pubkey.equals(market)))reject();
  if(accounts.filter(a=>a.pubkey.equals(FEE_ATA)).length!==1)reject();
  return {instruction:new TransactionInstruction({programId:JUPITER_PROGRAM,keys:accounts,data}),output,min,variant};
}

export async function resolveTables(route,rpc){
  const entries=route.addressesByLookupTableAddress;
  if(!entries||typeof entries!=='object'||Array.isArray(entries))reject();
  const names=Object.keys(entries);if(names.length>4)reject();
  if(!names.length)return [];
  const addresses=names.map(key),infos=await rpc.accounts(addresses);
  return infos.map((info,i)=>{
    if(!info||!info.owner.equals(AddressLookupTableProgram.programId)||info.executable)reject();
    const state=AddressLookupTableAccount.deserialize(info.data);
    if(state.deactivationSlot!==U64_MAX||state.lastExtendedSlot>=rpc.slot)reject();
    const supplied=entries[names[i]];
    if(!Array.isArray(supplied)||supplied.length!==state.addresses.length||supplied.some((s,n)=>!same(s,state.addresses[n])))reject();
    return new AddressLookupTableAccount({key:addresses[i],state});
  });
}

export function composeRoute(audited,input,state,wsolExists,feeExists,blockhash,tables){
  const wsol=getAssociatedTokenAddressSync(NATIVE_MINT,input.user),ixs=[];
  // Construct setup locally: never forward upstream setup/cleanup/other transfers.
  if(!feeExists)ixs.push(createAssociatedTokenAccountIdempotentInstruction(input.user,FEE_ATA,FEE_RECIPIENT,NATIVE_MINT));
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(input.user,wsol,input.user,NATIVE_MINT));
  if(input.action==='buy')ixs.push(SystemProgram.transfer({fromPubkey:input.user,toPubkey:wsol,lamports:input.amount}),createSyncNativeInstruction(wsol));
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(input.user,state.userBaseTokenAccount,input.user,input.mint,state.tokenProgram),audited.instruction);
  if(!wsolExists)ixs.push(createCloseAccountInstruction(wsol,input.user,input.user));
  const microLamports=BigInt(input.priorityFee)*1000000n/BigInt(COMPUTE_UNITS);
  const budget=[ComputeBudgetProgram.setComputeUnitLimit({units:COMPUTE_UNITS}),...(microLamports?[ComputeBudgetProgram.setComputeUnitPrice({microLamports})]:[])];
  const message=new TransactionMessage({payerKey:input.user,recentBlockhash:blockhash,instructions:[...budget,...ixs]}).compileToV0Message(tables);
  if(message.header.numRequiredSignatures!==1||!message.staticAccountKeys[0].equals(input.user))reject();
  const tx=new VersionedTransaction(message);let bytes;
  try{bytes=tx.serialize();}catch{throw new ApiError(422,'TRANSACTION_TOO_LARGE','Route exceeds the supported transaction size.');}
  if(bytes.length>1232||tx.signatures.some(s=>s.some(b=>b!==0)))reject();
  return {transaction:Buffer.from(bytes).toString('base64'),message:Buffer.from(message.serialize()).toString('base64'),transactionBytes:bytes.length,computeUnitLimit:COMPUTE_UNITS,priorityFeeLamports:String((microLamports*BigInt(COMPUTE_UNITS)+999999n)/1000000n),instructionSummary:[{programId:JUPITER_PROGRAM.toBase58(),operation:`pump_trade_with_${FEE_BPS}bps_fee`,recipient:FEE_RECIPIENT.toBase58(),feeAsset:'WSOL'}]};
}

let active=0;
export function simulatedServiceFee(result,built,input,tables){
  // Read this simulation's transfer, not a balance delta against an earlier RPC
  // snapshot: another customer's fee may arrive between those two snapshots.
  const message=VersionedTransaction.deserialize(Buffer.from(built.transaction,'base64')).message;
  const keys=message.getAccountKeys({addressLookupTableAccounts:tables});
  const swapIndex=message.compiledInstructions.findIndex(ix=>keys.get(ix.programIdIndex).equals(JUPITER_PROGRAM));
  const group=result.innerInstructions?.find(g=>g.index===swapIndex);
  if(!group||!Array.isArray(group.instructions))reject();
  const wsol=getAssociatedTokenAddressSync(NATIVE_MINT,input.user);
  let fee=0n,count=0,grossOutput=null;
  for(const ix of group.instructions){
    if(ix.programId===JUPITER_PROGRAM.toBase58()||keys.get(ix.programIdIndex)?.equals(JUPITER_PROGRAM)){
      if(typeof ix.data!=='string'||ix.data.length>200)continue;
      const event=Buffer.from(bs58.decode(ix.data));
      if(event.subarray(0,16).toString('hex')!=='e445a52e51cb9a1d982f4eebc0606e6a')continue;
      if(ix.stackHeight!==2||event.length!==132||event.readUInt32LE(16)!==1||grossOutput!==null)reject();
      if(!new PublicKey(event.subarray(100,132)).equals(keys.get(message.compiledInstructions[swapIndex].accountKeyIndexes[11])))reject();
      const buy=input.action==='buy';
      if(!new PublicKey(event.subarray(20,52)).equals(buy?NATIVE_MINT:input.mint)||!new PublicKey(event.subarray(60,92)).equals(buy?input.mint:NATIVE_MINT))reject();
      const spent=event.readBigUInt64LE(52);
      if(spent!==(buy?input.amount-feeFor(input.amount):input.amount))reject();
      grossOutput=event.readBigUInt64LE(92);continue;
    }
    if(ix.programId!==TOKEN_PROGRAM_ID.toBase58()&&!keys.get(ix.programIdIndex)?.equals(TOKEN_PROGRAM_ID))continue;
    if(ix.parsed){
      const {type,info}=ix.parsed;
      if(!['transfer','transferChecked'].includes(type)||info?.destination!==FEE_ATA.toBase58())continue;
      if(ix.stackHeight!==2||info.source!==wsol.toBase58()||info.authority!==input.user.toBase58()||(type==='transferChecked'&&(info.mint!==NATIVE_MINT.toBase58()||info.tokenAmount?.decimals!==9)))reject();
      fee+=uint(type==='transfer'?info.amount:info.tokenAmount?.amount);count++;continue;
    }
    if(typeof ix.data!=='string'||ix.data.length>32)continue;
    const data=Buffer.from(bs58.decode(ix.data));
    const checked=data[0]===12&&data.length===10,plain=data[0]===3&&data.length===9;
    if(!checked&&!plain)continue;
    const address=n=>typeof ix.accounts[n]==='string'?key(ix.accounts[n]):keys.get(ix.accounts[n]);
    if(!address(checked?2:1)?.equals(FEE_ATA))continue;
    if(ix.stackHeight!==2||!address(0)?.equals(wsol)||!address(checked?3:2)?.equals(input.user)||(checked&&(!address(1)?.equals(NATIVE_MINT)||data[9]!==9)))reject();
    fee+=data.readBigUInt64LE(1);count++;
  }
  if(grossOutput===null||count>1||fee!==feeFor(input.action==='buy'?input.amount:grossOutput))reject();
  return fee;
}
export async function jupiterTrade(body,env,build,rpcFactory=e=>new Rpc(e),fetcher=fetch){
  const input=tradeInput(body);
  if(input.user.equals(FEE_RECIPIENT))throw new ApiError(400,'INVALID_INPUT','Use a trading wallet different from the service fee recipient.');
  if(build&&!input.simulate)throw new ApiError(400,'SIMULATION_REQUIRED','This service requires simulation before returning a transaction.');
  if(active>=8)throw new ApiError(503,'BUSY','Build capacity is busy; retry later.');
  active++;
  try{
    const wsol=getAssociatedTokenAddressSync(NATIVE_MINT,input.user);
    const rpc=rpcFactory(env),state=await loadState(rpc,input,null,[wsol,FEE_ATA,JUPITER_PROGRAM]);
    quoteState(state,input); // Preserve liquidity, supported-state and graduation-boundary guards.
    const [wsolInfo,feeInfo,programInfo]=state.additionalAccounts;
    if(!programInfo?.executable)throw new ApiError(503,'ROUTER_UNAVAILABLE','The router program is unavailable.');
    const userWsol=tokenAccount(wsol,wsolInfo,NATIVE_MINT,input.user,TOKEN_PROGRAM_ID,true);
    const recipient=tokenAccount(FEE_ATA,feeInfo,NATIVE_MINT,FEE_RECIPIENT,TOKEN_PROGRAM_ID,true);
    if((userWsol&&!userWsol.isNative)||(recipient&&!recipient.isNative))reject();
    const route=await fetchRoute(input,state,env,fetcher),audited=auditRoute(route,input,state);
    const estimatedFee=input.action==='buy'?feeFor(input.amount):feeFor(uint(route.routePlan[0].swapInfo.outAmount));
    const response={venue:state.venue,pool:state.venue,poolAddress:(state.venue==='pump'?state.curveKey:state.poolKey).toBase58(),mint:input.mint.toBase58(),action:input.action,tradeMode:'exact_input',amountIn:input.amount.toString(),inputUnit:input.action==='buy'?'lamports':'raw_token_units',quotedOut:audited.output.toString(),expectedOut:audited.output.toString(),minOut:audited.min.toString(),outputUnit:input.action==='buy'?'raw_token_units':'lamports',tokenDecimals:state.mintAccount.decimals,slippageBps:input.slippageBps,contextSlot:state.slot,protocolFeesIncluded:true,quoteIsExecutionGuarantee:false,existingWsolAccountPreserved:!!wsolInfo,outputAsset:input.action==='buy'?'token':wsolInfo?'WSOL':'SOL',serviceFeeBps:FEE_BPS,feeRecipient:FEE_RECIPIENT.toBase58(),feeAccount:FEE_ATA.toBase58(),feeAsset:'WSOL',feeBasis:input.action==='buy'?'requested_SOL_input_including_service_fee':'actual_SOL_output_before_service_fee',feeIncludedInInput:input.action==='buy',outputIncludesServiceFee:true,estimatedServiceFeeLamports:estimatedFee.toString(),feeEstimateIsFinal:false,feeAccountSetupRequired:!feeInfo,feeAccountSetupPaidBy:'trader',feeRouterProgramId:JUPITER_PROGRAM.toBase58(),routingProvider:'Jupiter Metis',accountRentIncluded:false};
    if(!build)return {...response,simulation:{status:'not_run'}};
    if(!state.walletInfo)throw new ApiError(422,'WALLET_NOT_FUNDED','Wallet needs SOL for network fees and account rent.');
    if(input.action==='sell'&&(!state.userBase||state.userBase.amount<input.amount))throw new ApiError(422,'INSUFFICIENT_TOKEN_BALANCE','Wallet token account has insufficient raw units.');
    const tables=await resolveTables(route,rpc),latest=await rpc.latestBlockhash();
    if(typeof latest?.blockhash!=='string'||!Number.isSafeInteger(latest.lastValidBlockHeight)||latest.lastValidBlockHeight<=0||rpc.slot-state.slot>40)throw new ApiError(503,'STALE_STATE','State is too old; rebuild.');
    const built=composeRoute(audited,input,state,!!wsolInfo,!!feeInfo,latest.blockhash,tables),networkFee=await rpc.fee(built.message);
    if(!Number.isSafeInteger(networkFee)||networkFee<0)throw new ApiError(503,'FEE_UNAVAILABLE','Network fee could not be estimated.');
    if(BigInt(state.walletInfo.lamports)<BigInt(networkFee)+(input.action==='buy'?input.amount:0n))throw new ApiError(422,'INSUFFICIENT_SOL_BALANCE','Wallet lacks input SOL and network fees; account rent may also be required.');
    const simulation=await rpc.simulate(built.transaction,[FEE_ATA.toBase58()]);
    if(!simulation||simulation.err!==null)throw new ApiError(422,'SIMULATION_FAILED','Transaction simulation failed. Check balances, account rent, liquidity and current token stage, then rebuild. No transaction was submitted.');
    if(!Number.isSafeInteger(simulation.unitsConsumed)||simulation.unitsConsumed<=0||simulation.unitsConsumed>COMPUTE_UNITS)throw new ApiError(503,'INVALID_SIMULATION','RPC returned invalid simulation usage.');
    const post=simulation.accounts?.[0];
    if(!post||!Array.isArray(post.data)||post.data[1]!=='base64'||post.owner!==TOKEN_PROGRAM_ID.toBase58()||!Number.isSafeInteger(post.lamports))reject();
    const after=tokenAccount(FEE_ATA,{...post,data:Buffer.from(post.data[0],'base64'),owner:TOKEN_PROGRAM_ID},NATIVE_MINT,FEE_RECIPIENT,TOKEN_PROGRAM_ID);
    const simulatedFee=simulatedServiceFee(simulation,built,input,tables);
    if(!after.isNative)reject();
    const setupRent=!feeInfo?BigInt(post.lamports)-after.amount:0n;
    if(setupRent<0n)reject();
    const [currentCurve,currentPool]=await rpc.accounts([state.curveKey,sdk.pump.canonicalPumpPoolPda(input.mint)]);
    const curve=sdk.pump.PUMP_SDK.decodeBondingCurve(owned(currentCurve,sdk.pump.PUMP_PROGRAM_ID));
    if(chooseRoute(curve,input.pool,!!currentPool)!==state.venue)throw new ApiError(409,'VENUE_CHANGED','The token changed venue during construction; rebuild with pool=auto.');
    if(rpc.slot-state.slot>60||Date.now()-rpc.started>25000)throw new ApiError(503,'STALE_STATE','State aged out during simulation; rebuild.');
    const {message,...publicBuild}=built;
    return {...response,...publicBuild,requiredSigner:input.user.toBase58(),blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,estimatedNetworkFeeLamports:String(networkFee),feeAccountSetupRentLamports:setupRent.toString(),simulation:{status:'passed',contextSlot:rpc.slot,unitsConsumed:simulation.unitsConsumed,signatureVerification:false,serviceFeeLamports:simulatedFee.toString()},unsigned:true,submitted:false,rpcCalls:rpc.calls};
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(422,'UNSUPPORTED_OR_INVALID_STATE','Could not validate this market or build the trade. No transaction was submitted.');}
  finally{active--;}
}
