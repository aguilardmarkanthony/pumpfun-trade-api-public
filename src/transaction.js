import sdk from './sdk.cjs';
import {ComputeBudgetProgram,SystemProgram,SystemInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync} from '@solana/spl-token';
const {PUMP_PROGRAM_ID,PUMP_SDK} = sdk.pump;
const {PUMP_AMM_PROGRAM_ID,PUMP_AMM_SDK} = sdk.swap;
import {ApiError} from './http.js';
import {wrapWithFee,FEE_RECIPIENT} from './fees.js';
const invalid=()=>{throw new ApiError(500,'TRANSACTION_REJECTED','Generated transaction failed internal safety checks.');};
export const COMPUTE_UNITS=400000;
export function auditInstructions(ixs,input,state,quote) {
  const tradeProgram=state.venue==='pump'?PUMP_PROGRAM_ID:PUMP_AMM_PROGRAM_ID;
  const quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,input.user,false,TOKEN_PROGRAM_ID);
  let swaps=0,transfers=0;
  const summary=[];
  for(const ix of ixs){
    if(ix.keys.some(k=>k.isSigner&&!k.pubkey.equals(input.user)))invalid();
    if(ix.programId.equals(tradeProgram)){
      const coder=state.venue==='pump'?PUMP_SDK.offlinePumpProgram.coder.instruction:PUMP_AMM_SDK.offlineProgram.coder.instruction;
      const decoded=coder.decode(ix.data); if(!decoded)invalid();
      if(state.venue==='pump'&&state.routerProgram&&!state.volumeInfo&&decoded.name==='initUserVolumeAccumulator'){
        if(ix.data.length!==8||ix.keys.length!==6||!ix.keys[0].pubkey.equals(input.user)||!ix.keys[1].pubkey.equals(input.user)||!ix.keys[2].pubkey.equals(sdk.pump.userVolumeAccumulatorPda(input.user))||!ix.keys[3].pubkey.equals(SystemProgram.programId))invalid();
        summary.push({programId:ix.programId.toBase58(),operation:'initialize_volume_account_before_fee_measurement'});continue;
      }
      if(state.venue==='pumpswap'&&decoded.name==='extendAccount'){
        if(!ix.keys[0].pubkey.equals(state.poolKey)||!ix.keys.some(k=>k.isSigner&&k.pubkey.equals(input.user))||ix.data.length!==8)invalid();
        summary.push({programId:ix.programId.toBase58(),operation:'extend_protocol_pool_account'});continue;
      }
      swaps++;
      const buy=input.action==='buy';
      const expectedName=state.venue==='pump'?(quote.cashback?(buy?'buyV2':'sellV2'):(buy?'buyExactQuoteInV3':'sellV3')):(quote.cashback?(buy?'buy':'sell'):(buy?'buyExactQuoteInV2':'sellV2'));
      if(decoded.name!==expectedName)invalid();
      const first=ix.data.readBigUInt64LE(8),second=ix.data.readBigUInt64LE(16);
      const exactOutput=buy&&quote.cashback;
      if(first!==(exactOutput?quote.minOut:input.amount)||second!==(exactOutput?input.amount:quote.minOut))invalid();
      if(!ix.keys.some(k=>k.pubkey.equals(input.mint))||!ix.keys.some(k=>k.isSigner&&k.pubkey.equals(input.user)))invalid();
      summary.push({programId:ix.programId.toBase58(),operation:decoded.name});
    }else if(ix.programId.equals(SystemProgram.programId)){
      if(state.venue!=='pumpswap'||input.action!=='buy'||SystemInstruction.decodeInstructionType(ix)!=='Transfer')invalid();
      const t=SystemInstruction.decodeTransfer(ix);transfers++;
      if(!t.fromPubkey.equals(input.user)||!t.toPubkey.equals(quoteAta)||BigInt(t.lamports)!==input.amount)invalid();
      summary.push({programId:ix.programId.toBase58(),operation:'wrap_sol',lamports:String(t.lamports)});
    }else if(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)){
      if(![0,1].includes(ix.data[0]??0)||!ix.keys[0]?.pubkey.equals(input.user)||!ix.keys[2]?.pubkey.equals(input.user))invalid();
      const mint=ix.keys[3].pubkey,program=ix.keys[5].pubkey;
      if(!mint.equals(input.mint)&&!mint.equals(NATIVE_MINT))invalid();
      const expectedProgram=mint.equals(NATIVE_MINT)?TOKEN_PROGRAM_ID:state.tokenProgram;
      if(!program.equals(expectedProgram)||!ix.keys[1].pubkey.equals(getAssociatedTokenAddressSync(mint,input.user,false,program)))invalid();
      summary.push({programId:ix.programId.toBase58(),operation:'create_user_token_account'});
    }else if(ix.programId.equals(TOKEN_PROGRAM_ID)||ix.programId.equals(TOKEN_2022_PROGRAM_ID)){
      if(!ix.programId.equals(TOKEN_PROGRAM_ID)||!ix.keys[0]?.pubkey.equals(quoteAta))invalid();
      if(ix.data[0]===9){if(state.swap?.userQuoteAccountInfo||!ix.keys[1].pubkey.equals(input.user)||!ix.keys[2].pubkey.equals(input.user))invalid();}
      else if(ix.data[0]!==17)invalid();
      summary.push({programId:ix.programId.toBase58(),operation:ix.data[0]===9?'unwrap_new_wsol_account':'sync_native'});
    }else invalid();
  }
  if(swaps!==1||transfers!==(state.venue==='pumpswap'&&input.action==='buy'?1:0))invalid();
  return summary;
}
export function compileTransaction(ixs,input,state,quote,blockhash) {
  const summary=auditInstructions(ixs,input,state,quote);
  if(!state.routerProgram)throw new ApiError(503,'FEE_ROUTER_NOT_DEPLOYED','Fee router must be deployed and configured before building.');
  ixs=wrapWithFee(ixs,input,state,quote,state.routerProgram);
  summary.push({programId:state.routerProgram.toBase58(),operation:'atomic_trade_and_10bps_fee',recipient:FEE_RECIPIENT.toBase58(),feeAsset:state.venue==='pump'?'SOL':'WSOL'});
  const microLamports=BigInt(input.priorityFee)*1000000n/BigInt(COMPUTE_UNITS);
  const budget=[ComputeBudgetProgram.setComputeUnitLimit({units:COMPUTE_UNITS}),...(microLamports?[ComputeBudgetProgram.setComputeUnitPrice({microLamports})]:[])];
  const message=new TransactionMessage({payerKey:input.user,recentBlockhash:blockhash,instructions:[...budget,...ixs]}).compileToV0Message();
  if(message.header.numRequiredSignatures!==1||!message.staticAccountKeys[0].equals(input.user))invalid();
  let bytes;const tx=new VersionedTransaction(message);
  try {bytes=tx.serialize();}catch {throw new ApiError(422,'TRANSACTION_TOO_LARGE','This route exceeds the transaction packet size; lookup-table support is not enabled.');}
  if(bytes.length>1232)throw new ApiError(422,'TRANSACTION_TOO_LARGE','This route exceeds the 1232-byte Solana transaction limit.');
  if(tx.signatures.some(s=>s.some(b=>b!==0)))invalid();
  return {transaction:Buffer.from(bytes).toString('base64'),message:Buffer.from(message.serialize()).toString('base64'),transactionBytes:bytes.length,computeUnitLimit:COMPUTE_UNITS,priorityFeeLamports:String((microLamports*BigInt(COMPUTE_UNITS)+999999n)/1000000n),instructionSummary:summary};
}
