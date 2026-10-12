import {createHash,createPublicKey,verify} from 'node:crypto';
import {Connection,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {buildTrade} from './client.mjs';
import {tradeInput} from '../src/input.js';
import {FEE_BPS} from '../src/fees.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function bounded(task,ms){
  let timer;
  return Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Operation timed out.')),ms);})]).finally(()=>clearTimeout(timer));
}
function integer(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Invalid ${label}.`);return value;}
function lamports(value,label){if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new Error(`Invalid ${label}. Use a lamport string.`);return BigInt(value);}
function options(settings){
  if(settings.expectedRouterProgramId)throw new Error('Automatic execution supports the default Jupiter engine only.');
  const connection=settings.connection??new Connection(settings.rpcUrl??'https://api.mainnet-beta.solana.com','confirmed');
  return {connection,rpcTimeoutMs:integer(settings.rpcTimeoutMs??10000,1,30000,'RPC timeout'),
    signTimeoutMs:integer(settings.signTimeoutMs??30000,1,120000,'signing timeout'),
    confirmationTimeoutMs:integer(settings.confirmationTimeoutMs??45000,1,120000,'confirmation timeout'),
    pollIntervalMs:integer(settings.pollIntervalMs??800,1,10000,'poll interval'),
    maxFeeAccountSetupRentLamports:lamports(settings.maxFeeAccountSetupRentLamports??'0','fee account rent ceiling'),
    maxNetworkFeeLamports:lamports(settings.maxNetworkFeeLamports??'50000','network fee ceiling')};
}
function validateReceipt(record){
  if(typeof record.signature!=='string'||bs58.decode(record.signature).length!==64||
    !Number.isSafeInteger(record.lastValidBlockHeight)||record.lastValidBlockHeight<=0||
    !Number.isSafeInteger(record.contextSlot)||record.contextSlot<0)throw new Error('Invalid saved trade receipt.');
}

// Read-only recovery. A missing status (even after blockhash expiry) is not proof
// that a provider with incomplete history never saw the trade.
export async function trackTrade(settings,record){
  validateReceipt(record);
  const {connection,rpcTimeoutMs,confirmationTimeoutMs,pollIntervalMs}=options(settings);
  const started=performance.now(),deadline=started+confirmationTimeoutMs;
  let blockhashExpired=false;
  const result=(status,extra={})=>({operationId:record.operationId,signature:record.signature,status,blockhashExpired,trackingMs:Math.round(performance.now()-started),...extra});
  while(performance.now()<deadline){
    if(settings.signal?.aborted)return result('unknown',{reason:'Tracking cancelled; the trade may still land.'});
    try{
      const status=await bounded(()=>connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true}),Math.min(rpcTimeoutMs,Math.max(1,deadline-performance.now())));
      const value=status.value?.[0];
      if(value&&['confirmed','finalized'].includes(value.confirmationStatus)){
        if(value.err!==null&&value.err!==undefined)return result('failed',{error:value.err,confirmationStatus:value.confirmationStatus});
        if(value.err===null)return result('confirmed',{confirmationStatus:value.confirmationStatus,slot:value.slot});
      }
      const height=await bounded(()=>connection.getBlockHeight({commitment:'confirmed',minContextSlot:record.contextSlot}),Math.min(rpcTimeoutMs,Math.max(1,deadline-performance.now())));
      if(Number.isSafeInteger(height)&&height>record.lastValidBlockHeight){blockhashExpired=true;return result('unknown',{reason:'Blockhash expired; reconcile the original signature before placing another trade.'});}
    }catch{/* RPC outages and timeouts never authorize a second trade. */}
    await delay(Math.max(0,Math.min(pollIntervalMs,deadline-performance.now())));
  }
  return result('unknown',{reason:'Confirmation was not established within the tracking window.'});
}

// Invoked only by the user's bot. No server signer, no key loading, no live demo.
export async function executeTrade(settings,order,{operationId,journal,signTransaction}={}){
  const opts=options(settings),{connection,rpcTimeoutMs}=opts;
  if(!journal||typeof journal.reserve!=='function'||typeof journal.save!=='function'||typeof signTransaction!=='function')throw new Error('Provide a durable journal and a local signTransaction callback.');
  const snapshot=structuredClone({...order,maxServiceFeeBps:order.maxServiceFeeBps??FEE_BPS,simulate:true});
  tradeInput(snapshot);
  const fingerprint=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(snapshot).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
  const reservation=await journal.reserve(operationId,fingerprint);
  if(!reservation.created){
    if(!reservation.record.signature)return {operationId,status:'pending',reason:'This ID is already reserved. Do not start a replacement while the original operation is unresolved.'};
    return trackTrade(settings,reservation.record);
  }
  const timings={},start=performance.now();
  let durableRecord,sendAttempted=false;
  const unsubmitted=(reason)=>({operationId,status:'not_submitted',reason,timings});
  const checkFresh=async response=>{
    if(settings.signal?.aborted)throw new Error('Execution cancelled before submission.');
    const height=await bounded(()=>connection.getBlockHeight({commitment:'confirmed',minContextSlot:response.simulation.contextSlot}),rpcTimeoutMs);
    if(settings.signal?.aborted)throw new Error('Execution cancelled before submission.');
    if(!Number.isSafeInteger(height)||height>response.lastValidBlockHeight-5)throw new Error('Blockhash is expired or too close to expiry.');
  };
  try{
    if(settings.signal?.aborted)throw new Error('Execution cancelled before submission.');
    const {response,transaction}=await bounded(()=>buildTrade({...settings,connection},snapshot,{forExecution:true}),30000);
    if(lamports(response.feeAccountSetupRentLamports,'reported fee account rent')>opts.maxFeeAccountSetupRentLamports||
      lamports(response.estimatedNetworkFeeLamports,'reported network fee')>opts.maxNetworkFeeLamports)throw new Error('Build cost estimate exceeds your configured limit.');
    timings.buildAndInspectMs=Math.round(performance.now()-start);
    await checkFresh(response);
    const original=Buffer.from(transaction.message.serialize()),signStart=performance.now();
    const signed=await bounded(()=>signTransaction(transaction,{order:structuredClone(snapshot),response:structuredClone(response)}),opts.signTimeoutMs);
    if(!(signed instanceof VersionedTransaction)||!Buffer.from(signed.message.serialize()).equals(original)||signed.signatures.length!==1)throw new Error('Signer changed the transaction.');
    const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),transaction.message.staticAccountKeys[0].toBuffer()]),format:'der',type:'spki'});
    if(!verify(null,original,publicKey,signed.signatures[0]))throw new Error('Missing or invalid wallet signature.');
    // Capture immutable bytes before asynchronous journal work or signer mutation.
    const bytes=Buffer.from(signed.serialize()),signature=bs58.encode(signed.signatures[0]);
    timings.signMs=Math.round(performance.now()-signStart);
    durableRecord={...reservation.record,state:'prepared',signature,blockhash:response.blockhash,lastValidBlockHeight:response.lastValidBlockHeight,contextSlot:response.simulation.contextSlot};
    await journal.save(operationId,structuredClone(durableRecord)); // Must complete before any broadcast.
    await checkFresh(response);
    const sendStart=performance.now();
    let acknowledged=false;
    try{
      sendAttempted=true;
      const received=await bounded(()=>connection.sendRawTransaction(bytes,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2,minContextSlot:response.simulation.contextSlot}),rpcTimeoutMs);
      acknowledged=received===signature;
    }catch{/* The node may have accepted the bytes despite the missing reply. */}
    timings.submitMs=Math.round(performance.now()-sendStart);
    const tracked=await trackTrade(settings,durableRecord);
    return {...tracked,acknowledged,timings};
  }catch(error){
    // Errors after possible submission are handled inside the submission/tracker.
    // Saved signatures allow later read-only reconciliation after a process crash.
    if(sendAttempted)return {operationId,signature:durableRecord.signature,status:'unknown',reason:'Submission was attempted; reconcile the saved signature.',timings};
    return {...unsubmitted(error.message),...(durableRecord?{signature:durableRecord.signature}:{})};
  }
}
