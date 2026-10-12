import sdk from './sdk.cjs';
import BN from 'bn.js';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackMint,unpackAccount,getExtensionTypes,ExtensionType,createAssociatedTokenAccountIdempotentInstruction} from '@solana/spl-token';
const {PUMP_SDK,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,bondingCurvePda,canonicalPumpPoolPda,getBuyTokenAmountFromSolAmount,getBuyV3TokenAmountFromQuoteAmount,getSellSolAmountFromTokenAmount} = sdk.pump;
const {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,pumpPoolAuthorityPda,buyQuoteInput,sellBaseInput} = sdk.swap;
import {ApiError} from './http.js';
import {minimumOut,U64_MAX} from './input.js';
import {FEE_RECIPIENT} from './fees.js';
const bn=x=>new BN(String(x));
const bad=(message='On-chain account validation failed.')=>{throw new ApiError(503,'INVALID_CHAIN_STATE',message);};
export function owned(info,owner){if(!info||info.executable||!info.owner.equals(owner))bad();return info;}
export function decodeMint(mint,info) {
  if(!info||![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(p=>p.equals(info.owner)))bad();
  const decoded=unpackMint(mint,info,info.owner);
  if(!decoded.isInitialized)bad();
  const permitted=[ExtensionType.MetadataPointer,ExtensionType.TokenMetadata,ExtensionType.MintCloseAuthority];
  if(getExtensionTypes(decoded.tlvData).some(t=>!permitted.includes(t)))throw new ApiError(422,'UNSUPPORTED_TOKEN_EXTENSION','This mint has token extensions unsupported by this builder.');
  if(decoded.freezeAuthority)throw new ApiError(422,'UNSUPPORTED_FREEZE_AUTHORITY','Mints with a freeze authority are unsupported.');
  return decoded;
}
export function tokenAccount(address,info,mint,owner,program,optional=false) {
  if(info===null&&optional)return null;
  const account=unpackAccount(address,owned(info,program),program);
  if(!account.mint.equals(mint)||!account.owner.equals(owner)||!account.isInitialized||account.isFrozen)bad('Token account owner, mint or state mismatch.');
  return account;
}
export function chooseRoute(curve,poolChoice,poolExists) {
  if(!curve)throw new ApiError(404,'NOT_PUMP_TOKEN','Pump bonding curve account was not found.');
  const route=curve.complete?'pumpswap':'pump';
  if(poolChoice!=='auto'&&poolChoice!==route)throw new ApiError(409,'VENUE_CHANGED','Requested venue does not match current curve state; request a fresh automatic route.');
  if(curve.complete&&!poolExists)throw new ApiError(409,'MIGRATION_PENDING','Curve is complete but the canonical PumpSwap pool is unavailable. Raydium-only tokens are unsupported.');
  if(!curve.quoteMint.equals(PublicKey.default)&&!curve.quoteMint.equals(NATIVE_MINT))throw new ApiError(422,'UNSUPPORTED_QUOTE_MINT','Only SOL-paired tokens are supported.');
  return route;
}
export async function loadState(rpc,input,routerProgram=null,additionalKeys=[]) {
  const {mint,user}=input,curveKey=bondingCurvePda(mint),poolKey=canonicalPumpPoolPda(mint);
  const [mintInfo,curveInfo,poolInfo]=await rpc.accounts([mint,curveKey,poolKey]);
  if(!mintInfo)throw new ApiError(404,'MINT_NOT_FOUND','Mint account was not found.');
  decodeMint(mint,mintInfo);
  const curve=curveInfo?PUMP_SDK.decodeBondingCurve(owned(curveInfo,PUMP_PROGRAM_ID)):null;
  const venue=chooseRoute(curve,input.pool,!!poolInfo),tokenProgram=mintInfo.owner;
  const userBaseTokenAccount=getAssociatedTokenAddressSync(mint,user,false,tokenProgram);
  const userQuoteTokenAccount=getAssociatedTokenAddressSync(NATIVE_MINT,user,false,TOKEN_PROGRAM_ID);
  const keys=[mint,curveKey,userBaseTokenAccount,user];
  let firstPool;
  if(venue==='pump')keys.push(GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,getAssociatedTokenAddressSync(mint,curveKey,true,tokenProgram));
  else {
    firstPool=PUMP_AMM_SDK.decodePool(owned(poolInfo,PUMP_AMM_PROGRAM_ID));
    keys.push(poolKey,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,firstPool.poolBaseTokenAccount,firstPool.poolQuoteTokenAccount,userQuoteTokenAccount);
  }
  // All pricing inputs, vaults and balances are read from one confirmed bank.
  const volumeKey=sdk.pump.userVolumeAccumulatorPda(user);
  const extraIndex=keys.length;
  if(routerProgram)keys.push(routerProgram,FEE_RECIPIENT,...(venue==='pump'?[volumeKey]:[]));
  const additionalIndex=keys.length;
  keys.push(...additionalKeys);
  const accounts=await rpc.accounts(keys),[currentMintInfo,currentCurveInfo,userBaseAccountInfo,walletInfo]=accounts;
  if(routerProgram&&!accounts[extraIndex]?.executable)throw new ApiError(503,'FEE_ROUTER_NOT_DEPLOYED','Configured fee router is not an executable on-chain program.');
  if(routerProgram&&venue==='pump'){
    const recipient=accounts[extraIndex+1];
    if(!recipient||!recipient.owner.equals(SystemProgram.programId)||recipient.executable||recipient.data.length||recipient.lamports<=0)throw new ApiError(503,'FEE_RECIPIENT_NOT_READY','The operator must initialize the SOL fee recipient before enabling builds.');
  }
  const mintAccount=decodeMint(mint,currentMintInfo);
  if(!currentMintInfo.owner.equals(tokenProgram))bad();
  const currentCurve=PUMP_SDK.decodeBondingCurve(owned(currentCurveInfo,PUMP_PROGRAM_ID));
  if(currentCurve.complete!==curve.complete)throw new ApiError(409,'VENUE_CHANGED','The token changed venue during the snapshot; rebuild with pool=auto.');
  if(venue==='pumpswap'&&!accounts[4])throw new ApiError(409,'MIGRATION_PENDING','The canonical pool is unavailable in the current snapshot; rebuild after migration.');
  if(chooseRoute(currentCurve,input.pool,venue==='pumpswap')!==venue)throw new ApiError(409,'VENUE_CHANGED','The token changed venue during the snapshot; retry.');
  const userBase=tokenAccount(userBaseTokenAccount,userBaseAccountInfo,mint,user,tokenProgram,true);
  if(walletInfo&&(!walletInfo.owner.equals(SystemProgram.programId)||walletInfo.executable))throw new ApiError(422,'INVALID_WALLET','The wallet must be a normal system account.');
  const volumeInfo=routerProgram&&venue==='pump'?accounts[extraIndex+2]:undefined;
  if(volumeInfo&&(!volumeInfo.owner.equals(PUMP_PROGRAM_ID)||volumeInfo.executable||!volumeInfo.data.length))bad('Volume account is invalid.');
  const common={venue,mint,user,tokenProgram,mintAccount,curve:currentCurve,curveKey,userBaseTokenAccount,userBaseAccountInfo,userBase,walletInfo,slot:rpc.slot,routerProgram,volumeInfo,additionalAccounts:accounts.slice(additionalIndex)};
  if(venue==='pump') {
    const global=PUMP_SDK.decodeGlobal(owned(accounts[4],PUMP_PROGRAM_ID));
    const feeConfig=PUMP_SDK.decodeFeeConfig(owned(accounts[5],PUMP_FEE_PROGRAM_ID));
    const vault=tokenAccount(keys[6],accounts[6],mint,curveKey,tokenProgram);
    return {...common,global,feeConfig,curveBaseTokenBalance:bn(vault.amount)};
  }
  const pool=PUMP_AMM_SDK.decodePool(owned(accounts[4],PUMP_AMM_PROGRAM_ID));
  if(!pool.baseMint.equals(mint)||!pool.quoteMint.equals(NATIVE_MINT)||!pool.creator.equals(pumpPoolAuthorityPda(mint))||pool.index!==0||!pool.poolBaseTokenAccount.equals(firstPool.poolBaseTokenAccount)||!pool.poolQuoteTokenAccount.equals(firstPool.poolQuoteTokenAccount))bad('Canonical pool identity changed or is invalid.');
  const globalConfig=PUMP_AMM_SDK.decodeGlobalConfig(owned(accounts[5],PUMP_AMM_PROGRAM_ID));
  if((globalConfig.disableFlags & (input.action==='buy'?8:16))!==0)throw new ApiError(409,'TRADING_DISABLED','The protocol has disabled this trade direction.');
  const feeConfig=PUMP_AMM_SDK.decodeFeeConfig(owned(accounts[6],PUMP_FEE_PROGRAM_ID));
  const base=tokenAccount(keys[7],accounts[7],mint,poolKey,tokenProgram),quote=tokenAccount(keys[8],accounts[8],NATIVE_MINT,poolKey,TOKEN_PROGRAM_ID);
  const userQuote=tokenAccount(userQuoteTokenAccount,accounts[9],NATIVE_MINT,user,TOKEN_PROGRAM_ID,true);
  const effective=quote.amount+BigInt(pool.virtualQuoteReserves.toString());
  if(effective<=0n||effective>U64_MAX||base.amount===0n||BigInt(pool.protocolFees.add(pool.creatorFees).toString())>quote.amount)throw new ApiError(422,'INSUFFICIENT_LIQUIDITY','Pool has no usable liquidity.');
  return {...common,pool,poolKey,globalConfig,feeConfig,effectiveQuoteReserves:effective,swap:{globalConfig,feeConfig,poolKey,poolAccountInfo:accounts[4],pool,poolBaseAmount:bn(base.amount),poolQuoteAmount:bn(quote.amount),baseTokenProgram:tokenProgram,quoteTokenProgram:TOKEN_PROGRAM_ID,baseMint:mint,baseMintAccount:mintAccount,user,userBaseTokenAccount,userQuoteTokenAccount,userBaseAccountInfo,userQuoteAccountInfo:accounts[9]},userQuote};
}
export function quoteState(state,input) {
  let expected;
  const amount=bn(input.amount),cashback=state.venue==='pump'?state.curve.isCashbackCoin:state.pool.isCashbackCoin;
  if(state.venue==='pump'){
    const args={global:state.global,feeConfig:state.feeConfig,mintSupply:bn(state.mintAccount.supply),bondingCurve:state.curve,amount,quoteMint:NATIVE_MINT,curveBaseTokenBalance:state.curveBaseTokenBalance};
    expected=input.action==='buy'?(cashback?getBuyTokenAmountFromSolAmount(args):getBuyV3TokenAmountFromQuoteAmount(args)):getSellSolAmountFromTokenAmount(args);
    // Reject a snapshot crossing graduation rather than silently selecting partial-fill semantics.
    if(input.action==='buy'&&expected.gte(state.curve.realTokenReserves))throw new ApiError(409,'GRADUATION_BOUNDARY','Buy approaches curve completion; use a smaller amount or rebuild after migration.');
    if(input.action==='sell'&&expected.gt(state.curve.realQuoteReserves))throw new ApiError(422,'INSUFFICIENT_LIQUIDITY','Curve has insufficient real SOL reserves.');
  }else{
    const s=state.swap,p=state.pool;
    const args={slippage:0,baseReserve:s.poolBaseAmount,quoteReserve:s.poolQuoteAmount,virtualQuoteReserves:p.virtualQuoteReserves,feeBucketsTotal:p.protocolFees.add(p.creatorFees),globalConfig:s.globalConfig,baseMintAccount:s.baseMintAccount,baseMint:s.baseMint,coinCreator:p.coinCreator,creator:p.creator,feeConfig:s.feeConfig,quoteMint:p.quoteMint,isMayhemMode:p.isMayhemMode,creatorFeeBps:p.creatorFeeBps};
    expected=input.action==='buy'?buyQuoteInput({...args,quote:amount}).base:sellBaseInput({...args,base:amount}).uiQuote;
  }
  const quotedOut=BigInt(expected.toString()),minOut=minimumOut(quotedOut,input.slippageBps);
  return {quotedOut,minOut,expectedOut:input.action==='buy'&&cashback?minOut:quotedOut,tradeMode:input.action==='buy'&&cashback?'exact_output_with_max_input':'exact_input',cashback};
}
export async function instructions(state,input,quote) {
  const amount=bn(input.amount),minimum=bn(quote.minOut);
  let result;
  if(state.venue==='pump'){
    const recipients=state.global.buybackFeeRecipients.filter(p=>!p.equals(PublicKey.default));
    if(!recipients.length)bad('Protocol buyback recipients are unavailable.');
    const args={user:input.user,mint:input.mint,tokenProgram:state.tokenProgram,quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID,buybackFeeRecipient:recipients[0]};
    let swap;
    if(quote.cashback){
      const feeRecipient=state.curve.isMayhemMode?state.global.reservedFeeRecipient:state.global.feeRecipient;
      if(feeRecipient.equals(PublicKey.default))bad();
      const legacy={...args,creator:state.curve.creator,feeRecipient,amount:input.action==='buy'?minimum:amount,quoteAmount:input.action==='buy'?amount:minimum};
      swap=input.action==='buy'?await PUMP_SDK.getBuyV2InstructionRaw(legacy):await PUMP_SDK.getSellV2InstructionRaw(legacy);
    }else swap=input.action==='buy'?await PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({...args,spendableQuoteIn:amount,minTokensOut:minimum,partialFill:false}):await PUMP_SDK.getSellV3InstructionRaw({...args,amount,quoteAmount:minimum});
    result=[...(state.routerProgram&&!state.volumeInfo?[await PUMP_SDK.initUserVolumeAccumulator({payer:input.user,user:input.user})]:[]),...(input.action==='buy'?[createAssociatedTokenAccountIdempotentInstruction(input.user,state.userBaseTokenAccount,input.user,input.mint,state.tokenProgram)]:[]),swap];
  }else{
    if(quote.cashback)result=input.action==='buy'?await PUMP_AMM_SDK.buyInstructions(state.swap,minimum,amount):await PUMP_AMM_SDK.sellInstructions(state.swap,amount,minimum);
    else result=input.action==='buy'?await PUMP_AMM_SDK.buyExactQuoteInV2Instructions(state.swap,amount,minimum):await PUMP_AMM_SDK.sellV2Instructions(state.swap,amount,minimum);
    // SDK closes WSOL ATAs even when pre-existing. Preserve the user's existing account and funds.
    if(state.swap.userQuoteAccountInfo)result=result.filter(ix=>!(ix.programId.equals(TOKEN_PROGRAM_ID)&&ix.data[0]===9&&ix.keys[0].pubkey.equals(state.swap.userQuoteTokenAccount)));
  }
  return result;
}
