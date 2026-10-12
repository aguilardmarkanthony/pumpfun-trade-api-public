import {TransactionMessage,AddressLookupTableAccount,AddressLookupTableProgram} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {inspectPublicBuild} from './client.mjs';
import {composeRoute,JUPITER_PROGRAM} from '../src/jupiter.js';
import {tradeInput} from '../src/input.js';
import sdk from '../src/sdk.cjs';

// Restricted to the default Jupiter builder. Reconstruct every outer instruction
// instead of trusting a server-provided list of allowed programs or costs.
export async function inspectExecution(response,order,connection){
  if(response.simulation?.status!=='passed'||
    !Number.isSafeInteger(response.lastValidBlockHeight)||response.lastValidBlockHeight<=0||
    !Number.isSafeInteger(response.simulation.contextSlot)||response.simulation.contextSlot<0||
    typeof response.feeAccountSetupRequired!=='boolean')throw new Error('Invalid build context.');
  const cache=new Map();
  const getTable=key=>{
    const id=key.toBase58();
    if(!cache.has(id))cache.set(id,(async()=>{
      const info=await connection.getAccountInfo(key,{commitment:'confirmed',minContextSlot:response.simulation.contextSlot});
      if(!info||!info.owner.equals(AddressLookupTableProgram.programId)||info.executable)throw new Error('Invalid lookup table owner.');
      const state=AddressLookupTableAccount.deserialize(info.data);
      if(state.deactivationSlot!==(1n<<64n)-1n||state.lastExtendedSlot>=response.simulation.contextSlot)throw new Error('Lookup table is not active at the build slot.');
      return {value:new AddressLookupTableAccount({key,state})};
    })());
    return cache.get(id);
  };
  const tx=await inspectPublicBuild(response,order,{getAddressLookupTable:getTable}),input=tradeInput(order);
  if(response.blockhash!==tx.message.recentBlockhash)throw new Error('Invalid build context.');
  const tables=await Promise.all(tx.message.addressTableLookups.map(async lookup=>{
    const {value}=await getTable(lookup.accountKey);
    if(!value||!value.isActive())throw new Error('Lookup table unavailable.');
    return value;
  }));
  const decoded=TransactionMessage.decompile(tx.message,{addressLookupTableAccounts:tables});
  const swap=decoded.instructions.find(ix=>ix.programId.equals(JUPITER_PROGRAM));
  const variant=swap.data[34],graduated=[193,194].includes(variant);
  const protocol=graduated?sdk.swap.PUMP_AMM_PROGRAM_ID:sdk.pump.PUMP_PROGRAM_ID;
  const market=graduated?sdk.pump.canonicalPumpPoolPda(input.mint):sdk.pump.bondingCurvePda(input.mint);
  const key=n=>swap.keys[n]?.pubkey;
  if((input.pool==='pump'&&graduated)||(input.pool==='pumpswap'&&!graduated)||!key(input.action==='buy'?5:6)?.equals(TOKEN_PROGRAM_ID))throw new Error('Unexpected requested venue or SOL token program.');
  if(!key(7)?.equals(JUPITER_PROGRAM)||!key(9)?.equals(JUPITER_PROGRAM)||
    key(8)?.toBase58()!=='D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'||
    !key(11)?.equals(protocol)||!swap.keys.slice(12).some(k=>k.pubkey.equals(market)))throw new Error('Unexpected protocol or market.');
  const tokenProgram=key(input.action==='buy'?6:5);
  const wsol=getAssociatedTokenAddressSync(NATIVE_MINT,input.user);
  const existingWsol=await connection.getAccountInfo(wsol,{commitment:'confirmed',minContextSlot:response.simulation.contextSlot});
  const state={tokenProgram,userBaseTokenAccount:getAssociatedTokenAddressSync(input.mint,input.user,false,tokenProgram)};
  const rebuilt=composeRoute({instruction:swap},input,state,!!existingWsol,!response.feeAccountSetupRequired,response.blockhash,tables);
  if(!Buffer.from(tx.message.serialize()).equals(Buffer.from(rebuilt.message,'base64')))throw new Error('Unexpected setup, cleanup, transfer or compute budget.');
  return tx;
}
