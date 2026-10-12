import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {FEE_RECIPIENT,FEE_ATA} from '../src/fees.js';

async function request(settings,path,order){
  const url=new URL(path,settings.baseUrl);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Use HTTPS outside localhost.');
  if(!settings.apiSecret) throw new Error('Set API_SECRET to your server API password.');
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-RapidAPI-Proxy-Secret':settings.apiSecret},body:JSON.stringify(order)});
  const result=await response.json();
  if(!response.ok) throw new Error(`${result.error?.code??response.status}: ${result.error?.message??'Request failed'}`);
  return result;
}
export const quoteTrade=(settings,order)=>request(settings,'/api/quote',order);

export function inspectBuild(response,order,expectedRouterProgramId){
  if(!expectedRouterProgramId) throw new Error('Set the verified fee router program ID before building.');
  if(response.unsigned!==true||response.submitted!==false||response.serviceFeeBps!==10||response.feeRecipient!==FEE_RECIPIENT.toBase58()) throw new Error('Unexpected transaction or fee policy.');
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

export async function buildTrade(settings,order){
  if(!settings.expectedRouterProgramId) throw new Error('Set the verified fee router program ID before building.');
  const response=await request(settings,'/api/trade/local',{...order,simulate:true});
  if(response.simulation?.status!=='passed') throw new Error('A successful simulation is required by this example.');
  return {response,transaction:inspectBuild(response,order,settings.expectedRouterProgramId)};
}
