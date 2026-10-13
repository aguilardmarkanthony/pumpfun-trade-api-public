import {PublicKey} from '@solana/web3.js';
import {ApiError,boundedText} from './http.js';
export class Rpc {
  constructor(env={}, fetcher=fetch) {
    this.url=env.SOLANA_RPC_URL;
    let url; try {url=new URL(this.url);} catch {throw new ApiError(503,'RPC_NOT_CONFIGURED','RPC configuration is invalid.');}
    if(url.protocol!=='https:' || url.username || url.password) throw new ApiError(503,'RPC_NOT_CONFIGURED','Configure an HTTPS RPC URL.');
    this.fetcher=fetcher.bind(globalThis);this.slot=0;this.calls=0;this.started=Date.now();
  }
  async call(method,params) {
    if(!['getMultipleAccounts','getLatestBlockhash','getFeeForMessage','simulateTransaction'].includes(method)) throw new Error('Forbidden RPC method');
    if(++this.calls>8 || Date.now()-this.started>20000) throw new ApiError(503,'RPC_BUDGET_EXCEEDED','RPC work limit reached; retry with fresh state.');
    const id=this.calls,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);let reason='transport';
    try {
      const response=await this.fetcher(this.url,{method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
      if(!response.ok){reason='http_'+response.status;void response.body?.cancel().catch(()=>{});throw new Error('RPC HTTP status');}
      reason='body';
      const result=JSON.parse(await boundedText(response.body,1048576,7000));
      reason=Number.isSafeInteger(result.error?.code)?'rpc_'+result.error.code:'envelope';
      if(result.id!==id || result.jsonrpc!=='2.0' || result.error || !result.result) throw new Error('RPC response');
      const slot=result.result.context?.slot;
      reason='context';if(!Number.isSafeInteger(slot)||slot<this.slot) throw new Error('Invalid or regressed RPC context');
      this.slot=slot;return result.result.value;
    } catch {console.warn('rpc_failure',method,controller.signal.aborted?'timeout':reason);throw new ApiError(503,'RPC_UNAVAILABLE','The Solana RPC could not provide a valid response; retry later.');}
    finally {clearTimeout(timer);}
  }
  async accounts(keys) {
    const result=await this.call('getMultipleAccounts',[keys.map(k=>k.toBase58()),{encoding:'base64',commitment:'confirmed',...(this.slot?{minContextSlot:this.slot}:{})}]);
    if(!Array.isArray(result)||result.length!==keys.length) throw new ApiError(503,'RPC_INVALID_STATE','RPC account count mismatch.');
    return result.map(a=>{
      if(a===null)return null;
      try {
        if(!Array.isArray(a.data)||a.data[1]!=='base64'||typeof a.data[0]!=='string'||a.data[0].length>90000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.data[0])||typeof a.executable!=='boolean'||!Number.isSafeInteger(a.lamports)||a.lamports<0)throw new Error();
        return {data:Buffer.from(a.data[0],'base64'),owner:new PublicKey(a.owner),lamports:a.lamports,executable:a.executable};
      }catch{throw new ApiError(503,'RPC_INVALID_STATE','RPC returned malformed account data.');}
    });
  }
  latestBlockhash(){return this.call('getLatestBlockhash',[{commitment:'confirmed',minContextSlot:this.slot}]);}
  fee(message){return this.call('getFeeForMessage',[message,{commitment:'confirmed',minContextSlot:this.slot}]);}
  simulate(transaction,addresses){return this.call('simulateTransaction',[transaction,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',minContextSlot:this.slot,...(addresses?{accounts:{encoding:'base64',addresses},innerInstructions:true}:{})}]);}
}
