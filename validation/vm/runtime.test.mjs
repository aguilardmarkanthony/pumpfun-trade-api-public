import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiteSVM,FailedTransactionMetadata} from 'litesvm';
import {getTransactionDecoder} from '@solana/kit';
import {SystemProgram,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,NATIVE_MINT,MintLayout,AccountLayout} from '@solana/spl-token';
import sdk from '../../src/sdk.cjs';
import {fixture,buy,sell,USER,OTHER,ROUTER,tokenInfo} from '../../test/fixtures.js';
import {FEE_RECIPIENT,FEE_ATA,wrapWithFee} from '../../src/fees.js';
import {tradeInput} from '../../src/input.js';
import {loadState,quoteState,instructions} from '../../src/protocol.js';

const directory=process.env.SBF_ARTIFACT_DIR;
if(!directory)throw new Error('Set SBF_ARTIFACT_DIR to the compiled router and mock-market artifacts.');
const routerBytes=readFileSync(`${directory}/pump_trade_fee_router.so`),mockBytes=readFileSync(`${directory}/mock_market.so`);
const GROSS=750001999n,FEE=750001n;

async function setup({graduated=false,action='buy',cashback=false,attack}={}){
  const f=await fixture({graduated,cashback,existingWsol:true});
  const input=tradeInput(action==='buy'?{...buy,amount:'1'}:sell);
  const state=await loadState(f.rpc,input,ROUTER),quote=quoteState(state,input);
  const wrapped=wrapWithFee(await instructions(state,input,quote),input,state,quote,ROUTER);
  const svm=new LiteSVM().withSigverify(false);
  svm.addProgram(ROUTER.toBase58(),routerBytes);
  svm.addProgram(sdk.pump.PUMP_PROGRAM_ID.toBase58(),mockBytes);
  svm.addProgram(sdk.swap.PUMP_AMM_PROGRAM_ID.toBase58(),mockBytes);
  const nativeMint=Buffer.alloc(MintLayout.span);
  MintLayout.encode({mintAuthorityOption:0,mintAuthority:SystemProgram.programId,supply:0n,decimals:9,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:SystemProgram.programId},nativeMint);
  f.accounts.set(NATIVE_MINT.toBase58(),{owner:TOKEN_PROGRAM_ID,data:nativeMint,lamports:10000000,executable:false});
  f.accounts.set(FEE_ATA.toBase58(),tokenInfo(NATIVE_MINT,FEE_RECIPIENT,0n));
  for(const [address,info] of f.accounts){
    if(address===ROUTER.toBase58())continue;
    let lamports=BigInt(info.lamports);
    if(info.owner.equals(TOKEN_PROGRAM_ID)&&info.data.length===165){
      const token=AccountLayout.decode(info.data);
      if(token.mint.equals(NATIVE_MINT)){
        const rent=svm.minimumBalanceForRentExemption(165n);
        token.isNative=rent;AccountLayout.encode(token,info.data);lamports=rent+token.amount;
      }
    }
    if(attack==='stage'&&address===state.curveKey.toBase58())info.data[48]=graduated?0:1;
    svm.setAccount({address,programAddress:info.owner.toBase58(),data:info.data,lamports,executable:info.executable,space:BigInt(info.data.length)});
  }
  if(attack==='recipient')wrapped.find(ix=>ix.programId.equals(ROUTER)).keys[1].pubkey=OTHER;
  if(attack==='rollback')wrapped.push(SystemProgram.transfer({fromPubkey:USER,toPubkey:OTHER,lamports:90000000000000n}));
  const message=new TransactionMessage({payerKey:USER,recentBlockhash:svm.latestBlockhash(),instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...wrapped]}).compileToV0Message();
  const bytes=new VersionedTransaction(message).serialize();
  const destination=graduated?FEE_ATA:FEE_RECIPIENT;
  const balance=()=>graduated?AccountLayout.decode(Buffer.from(svm.getAccount(destination.toBase58()).data)).amount:svm.getBalance(destination.toBase58());
  return {svm,bytes,balance};
}

for(const graduated of [false,true])for(const action of ['buy','sell'])for(const cashback of [false,true])test(`SBF runtime: ${graduated?'AMM':'curve'} ${action}, cashback=${cashback}, actual fee`,async()=>{
  const {svm,bytes,balance}=await setup({graduated,action,cashback});const before=balance();
  const result=svm.sendTransaction(getTransactionDecoder().decode(bytes));
  if(result instanceof FailedTransactionMetadata)assert.fail(JSON.stringify({error:String(result.err()),logs:result.meta().logs()}));
  assert.equal(balance()-before,FEE);
  assert.notEqual(FEE,GROSS);assert.ok(result.computeUnitsConsumed()<400000n);
});
for(const attack of ['stage','recipient','rollback'])test(`SBF runtime refuses ${attack} and leaves fee recipient unchanged`,async()=>{
  const {svm,bytes,balance}=await setup({attack,action:'sell'});const before=balance();
  const result=svm.sendTransaction(getTransactionDecoder().decode(bytes));
  assert.ok(result instanceof FailedTransactionMetadata);assert.equal(balance(),before);
});
