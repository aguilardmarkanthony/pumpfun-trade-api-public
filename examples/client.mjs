import {Connection,PublicKey,VersionedTransaction} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {FEE_RECIPIENT,FEE_ATA,FEE_BPS} from '../src/fees.js';
import {JUPITER_PROGRAM} from '../src/jupiter.js';
import {tradeInput} from '../src/input.js';

async function request(settings,path,order){
  const url=new URL(path,settings.baseUrl);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Use HTTPS outside localhost.');
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(settings.apiKey?{Authorization:`Bearer ${settings.apiKey}`}:{})},body:JSON.stringify(order)});
  const result=await response.json();
  if(!response.ok) throw new Error(`${result.error?.code??response.status}: ${result.error?.message??'Request failed'}`);
  return result;
}
const withFeeLimit=order=>({...order,maxServiceFeeBps:order.maxServiceFeeBps??FEE_BPS});
export const quoteTrade=(settings,order)=>request(settings,'/api/quote',withFeeLimit(order));

export function inspectBuild(response,order,expectedRouterProgramId){
  tradeInput(order); // Enforce the caller's fee ceiling before returning any bytes.
  if(!expectedRouterProgramId) throw new Error('Set the verified fee router program ID before building.');
  if(response.unsigned!==true||response.submitted!==false||response.serviceFeeBps!==FEE_BPS||response.feeRecipient!==FEE_RECIPIENT.toBase58()) throw new Error('Unexpected transaction or fee policy.');
  const bytes=Buffer.from(response.transaction,'base64');
  if(bytes.length>1232) throw new Error('Oversized transaction.');
  const transaction=VersionedTransaction.deserialize(bytes),message=transaction.message;
  if(message.header.numRequiredSignatures!==1||message.staticAccountKeys[0].toBase58()!==order.publicKey||transaction.signatures.some(s=>s.some(b=>b!==0))) throw new Error('Unexpected signer or signature.');
  if(message.addressTableLookups.length) throw new Error('Lookup-table transactions are unsupported by this sample.');
  const router=new PublicKey(expectedRouterProgramId);
  const calls=message.compiledInstructions.filter(ix=>message.staticAccountKeys[ix.programIdIndex].equals(router));
  if(calls.length!==1) throw new Error('Expected exactly one fee router call.');
  const call=calls[0];
  const key=index=>message.staticAccountKeys[call.accountKeyIndexes[index]];
  if(!key(1)?.equals(FEE_RECIPIENT)||!key(3)?.equals(new PublicKey(order.mint))||call.data[0]!==1||call.data[2]!==Number(order.action==='sell')) throw new Error('Unexpected fee recipient, mint or direction.');
  if(![0,1].includes(call.data[1])||!key(5)?.equals(call.data[1]===0?FEE_RECIPIENT:FEE_ATA)) throw new Error('Unexpected fee destination.');
  return transaction;
}

export async function buildTrade(settings,order,{forExecution=false}={}){
  order=withFeeLimit(order);
  const response=await request(settings,'/api/trade/local',{...order,simulate:true});
  if(response.simulation?.status!=='passed') throw new Error('A successful simulation is required by this example.');
  const connection=settings.connection??new Connection(settings.rpcUrl??'https://api.mainnet-beta.solana.com','confirmed');
  if(forExecution&&settings.expectedRouterProgramId)throw new Error('Execution supports the default Jupiter engine only.');
  const transaction=forExecution
    ? await (await import('./execution-inspection.mjs')).inspectExecution(response,order,connection)
    : settings.expectedRouterProgramId
    ? inspectBuild(response,order,settings.expectedRouterProgramId)
    : await inspectPublicBuild(response,order,connection);
  return {response,transaction};
}

// Basic client checks. These do not replace a wallet's full instruction review.
export async function inspectPublicBuild(response,order,connection){
  if(response.unsigned!==true||response.submitted!==false||response.serviceFeeBps!==FEE_BPS||response.feeRecipient!==FEE_RECIPIENT.toBase58()||response.feeAccount!==FEE_ATA.toBase58()||response.feeRouterProgramId!==JUPITER_PROGRAM.toBase58())throw new Error('Unexpected fee policy.');
  const bytes=Buffer.from(response.transaction,'base64');if(bytes.length>1232)throw new Error('Oversized transaction.');
  const transaction=VersionedTransaction.deserialize(bytes),message=transaction.message,input=tradeInput(order);
  if(message.header.numRequiredSignatures!==1||!message.staticAccountKeys[0].equals(input.user)||transaction.signatures.some(s=>s.some(b=>b!==0))||message.addressTableLookups.length>4)throw new Error('Unexpected signer or signature.');
  const tables=[];
  for(const lookup of message.addressTableLookups){const {value}=await connection.getAddressLookupTable(lookup.accountKey);if(!value||!value.isActive())throw new Error('Lookup table is unavailable.');tables.push(value);}
  const keys=message.getAccountKeys({addressLookupTableAccounts:tables});
  const swaps=message.compiledInstructions.filter(ix=>keys.get(ix.programIdIndex).equals(JUPITER_PROGRAM));if(swaps.length!==1)throw new Error('Expected one Jupiter swap.');
  const ix=swaps[0],data=Buffer.from(ix.data),k=i=>keys.get(ix.accountKeyIndexes[i]);
  const buy=input.action==='buy',variant=data[34],variants=buy?[187,191,193]:[153,192,194];
  const fields=[187,191].includes(variant)?2:1;
  if(!variants.includes(variant)||data.length!==39+fields||data.subarray(0,8).toString('hex')!=='bb64facc31c4af14'||data.readBigUInt64LE(8)!==input.amount||data.readUInt16LE(24)!==input.slippageBps||data.readUInt16LE(26)!==FEE_BPS||data.readUInt16LE(28)!==0||data.readUInt32LE(30)!==1||data.subarray(35,35+fields).some(x=>x!==0)||data.readUInt16LE(35+fields)!==10000||data[37+fields]!==0||data[38+fields]!==1)throw new Error('Unexpected amount, slippage, fee or route.');
  const output=data.readBigUInt64LE(16),minimum=(output*BigInt(10000-input.slippageBps)+9999n)/10000n;
  if(output===0n||minimum===0n||response.expectedOut!==output.toString()||response.minOut!==minimum.toString())throw new Error('Response output bounds disagree with the transaction.');
  const tokenProgram=k(buy?6:5);if(![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(p=>p.equals(tokenProgram)))throw new Error('Unexpected token program.');
  const sourceMint=buy?NATIVE_MINT:input.mint,destMint=buy?input.mint:NATIVE_MINT;
  if(!k(0).equals(input.user)||!k(3).equals(sourceMint)||!k(4).equals(destMint)||!k(10).equals(FEE_ATA)||!k(1).equals(getAssociatedTokenAddressSync(sourceMint,input.user,false,buy?TOKEN_PROGRAM_ID:tokenProgram))||!k(2).equals(getAssociatedTokenAddressSync(destMint,input.user,false,buy?tokenProgram:TOKEN_PROGRAM_ID)))throw new Error('Unexpected trader, mint or fee destination.');
  return transaction;
}
