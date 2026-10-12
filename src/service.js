import sdk from './sdk.cjs';
const {PUMP_SDK,PUMP_PROGRAM_ID,bondingCurvePda,canonicalPumpPoolPda} = sdk.pump;
import {ApiError,app,bodyJson,query} from './http.js';
import {Rpc} from './rpc.js';
import {tradeInput,publicKey} from './input.js';
import {loadState,quoteState,instructions,owned,chooseRoute} from './protocol.js';
import {compileTransaction} from './transaction.js';
import {routerConfig,feeFor,feeDisclosure,FEE_BPS,FEE_RECIPIENT} from './fees.js';
let active=0;
function quoteResponse(state,input,quote){
  return {venue:state.venue,pool:state.venue,poolAddress:state.venue==='pump'?state.curveKey.toBase58():state.poolKey.toBase58(),mint:input.mint.toBase58(),action:input.action,tradeMode:quote.tradeMode,amountIn:input.amount.toString(),inputUnit:input.action==='buy'?'lamports':'raw_token_units',quotedOut:quote.quotedOut.toString(),expectedOut:quote.expectedOut.toString(),minOut:quote.minOut.toString(),outputUnit:input.action==='buy'?'raw_token_units':'lamports',tokenDecimals:state.mintAccount.decimals,slippageBps:input.slippageBps,contextSlot:state.slot,protocolFeesIncluded:true,quoteIsExecutionGuarantee:false,existingWsolAccountPreserved:!!state.swap?.userQuoteAccountInfo,outputAsset:input.action==='buy'?'token':state.swap?.userQuoteAccountInfo?'WSOL':'SOL'};
}
export async function trade(body,env,build,rpcFactory=e=>new Rpc(e)) {
  const input=tradeInput(body); // Invalid input must cause zero RPC calls.
  const routerProgram=routerConfig(env,build);
  if(active>=8)throw new ApiError(503,'BUSY','Build capacity is busy; retry later.');
  active++;
  try {
    const rpc=rpcFactory(env),state=await loadState(rpc,input,routerProgram),quote=quoteState(state,input),response={...quoteResponse(state,input,quote),...feeDisclosure(state,input,quote)};
    delete response.feeLamports; // A quote cannot know the eventual balance delta.
    if(!build)return {...response,simulation:{status:'not_run'}};
    if(input.action==='sell'&&(!state.userBase||state.userBase.amount<input.amount))throw new ApiError(422,'INSUFFICIENT_TOKEN_BALANCE','Wallet token account has insufficient raw units.');
    if(!state.walletInfo)throw new ApiError(422,'WALLET_NOT_FUNDED','Wallet needs SOL for network fees and account rent.');
    const ixs=await instructions(state,input,quote),latest=await rpc.latestBlockhash();
    if(typeof latest?.blockhash!=='string'||!Number.isSafeInteger(latest.lastValidBlockHeight)||latest.lastValidBlockHeight<=0||rpc.slot-state.slot>40)throw new ApiError(503,'STALE_STATE','Blockhash or pricing state is unavailable or too old; rebuild.');
    const built=compileTransaction(ixs,input,state,quote,latest.blockhash),fee=await rpc.fee(built.message);
    if(!Number.isSafeInteger(fee)||fee<0)throw new ApiError(503,'FEE_UNAVAILABLE','Network fee could not be estimated.');
    if(BigInt(state.walletInfo.lamports)<BigInt(fee)+(input.action==='buy'?input.amount+feeFor(input.amount):0n))throw new ApiError(422,'INSUFFICIENT_SOL_BALANCE','Wallet lacks input SOL, maximum service fee and network fee; account rent may also be required.');
    let simulation={status:'not_run'};
    if(input.simulate){
      const result=await rpc.simulate(built.transaction);
      if(!result||result.err!==null)throw new ApiError(422,'SIMULATION_FAILED','Transaction simulation failed. Check balances/rent, mint support and current liquidity, then rebuild. No transaction was submitted.');
      if(!Number.isSafeInteger(result.unitsConsumed)||result.unitsConsumed<=0||result.unitsConsumed>built.computeUnitLimit)throw new ApiError(503,'INVALID_SIMULATION','RPC returned invalid simulation usage.');
      simulation={status:'passed',contextSlot:rpc.slot,unitsConsumed:result.unitsConsumed,signatureVerification:false};
    }
    if(rpc.slot-state.slot>60||(rpc.started&&Date.now()-rpc.started>25000))throw new ApiError(503,'STALE_STATE','State aged out during construction or simulation; rebuild.');
    const {message,...publicBuild}=built;
    return {...response,...publicBuild,requiredSigner:input.user.toBase58(),blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,estimatedNetworkFeeLamports:String(fee),accountRentIncluded:false,simulation,unsigned:true,submitted:false,rpcCalls:rpc.calls};
  }catch(error){
    if(error instanceof ApiError)throw error;
    throw new ApiError(422,'UNSUPPORTED_OR_INVALID_STATE','The protocol SDK could not validate or build this trade. No transaction was submitted.');
  }finally{active--;}
}
export function createService(rpcFactory=e=>new Rpc(e)){
 return app('Pump Trade Router',[
  {path:'/api/trade/local',method:'POST',handle:async({request,url,env})=>{query(url,[]);return trade(await bodyJson(request),env,true,rpcFactory);}},
  {path:'/api/quote',method:'POST',handle:async({request,url,env})=>{query(url,[]);return trade(await bodyJson(request),env,false,rpcFactory);}},
  {path:/^\/api\/curve\/[^/]+$/,method:'GET',handle:async({url,env})=>{
    query(url,[]);const mint=publicKey(decodeURIComponent(url.pathname.split('/').at(-1))),rpc=rpcFactory(env);
    const [curveInfo,poolInfo]=await rpc.accounts([bondingCurvePda(mint),canonicalPumpPoolPda(mint)]);
    if(!curveInfo)throw new ApiError(404,'NOT_PUMP_TOKEN','Pump bonding curve account was not found.');
    const c=PUMP_SDK.decodeBondingCurve(owned(curveInfo,PUMP_PROGRAM_ID));
    let route;try{route=chooseRoute(c,'auto',!!poolInfo);}catch(e){if(e.code==='MIGRATION_PENDING')route='migration_pending';else throw e;}
    return {mint:mint.toBase58(),complete:c.complete,route,contextSlot:rpc.slot,virtualTokenReserves:c.virtualTokenReserves.toString(),virtualQuoteReserves:c.virtualQuoteReserves.toString(),realTokenReserves:c.realTokenReserves.toString(),realQuoteReserves:c.realQuoteReserves.toString(),tokenTotalSupply:c.tokenTotalSupply.toString(),isCashbackCoin:c.isCashbackCoin,isMayhemMode:c.isMayhemMode,quoteMint:c.quoteMint.toBase58(),poolValidated:false};
  }},
  {path:'/api/capabilities',method:'GET',handle:({url,env})=>{query(url,[]);return {version:'0.1.0-preview',feeRouterProgramId:routerConfig(env)?.toBase58()??null,feeRecipient:FEE_RECIPIENT.toBase58(),releaseStage:'developer_preview',venues:['pump','pumpswap'],quoteAssets:['SOL'],unsignedOnly:true,serviceFeeBps:FEE_BPS,maxBuySol:'100',maxBodyBytes:8192,slippageBps:{default:100,min:1,max:5000},simulationDefault:true,raydium:false,eventHistory:false,sdkVersions:{pump:'4.0.0',pumpswap:'2.1.0'}};}}
 ]);
}
