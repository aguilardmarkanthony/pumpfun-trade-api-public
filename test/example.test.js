import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectBuild} from '../examples/client.mjs';
import {tradeInput} from '../src/input.js';
import {trade} from '../src/service.js';
import {fixture,buy,ENV,ROUTER,OTHER} from './fixtures.js';
import {buildFeeWalletSetup} from '../examples/fee-wallet-setup.mjs';
import {VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {ASSOCIATED_TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {FEE_RECIPIENT} from '../src/fees.js';

test('copyable JSON examples match the input contract',()=>{
  for(const file of ['buy','sell']){
    const input=tradeInput(JSON.parse(readFileSync(new URL(`../examples/${file}.json`,import.meta.url),'utf8')));
    assert.equal(input.action,file);assert.equal(input.simulate,true);assert.equal(input.pool,'auto');
  }
});
test('sample client accepts a build and rejects a changed fee or router',async()=>{
  const f=await fixture();const response=await trade(buy,ENV,true,()=>f.rpc);
  assert.ok(inspectBuild(response,buy,ROUTER.toBase58()));
  assert.throws(()=>inspectBuild({...response,feeRecipient:OTHER.toBase58()},buy,ROUTER.toBase58()),/fee policy/);
  assert.throws(()=>inspectBuild(response,buy,OTHER.toBase58()),/router call/);
});

test('wallet setup reports funding needs and builds only unsigned ATA creation',async()=>{
  let wallet=null;
  const connection={getMultipleAccountsInfo:async()=>[wallet,null],getMinimumBalanceForRentExemption:async size=>size?1488440:650240,getLatestBlockhash:async()=>({blockhash:OTHER.toBase58(),lastValidBlockHeight:300}),getFeeForMessage:async()=>({value:5000})};
  const pending=await buildFeeWalletSetup(connection);
  assert.equal(pending.ready,false);assert.equal(pending.additionalFundingLamports,'2143680');assert.equal(pending.transaction,undefined);
  wallet={owner:SystemProgram.programId,executable:false,data:Buffer.alloc(0),lamports:3000000};
  const ready=await buildFeeWalletSetup(connection),transaction=VersionedTransaction.deserialize(Buffer.from(ready.transaction,'base64'));
  assert.equal(ready.requiredSigner,FEE_RECIPIENT.toBase58());assert.equal(ready.submitted,false);
  assert.equal(transaction.message.compiledInstructions.length,1);
  assert.ok(transaction.message.staticAccountKeys[transaction.message.compiledInstructions[0].programIdIndex].equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.ok(transaction.signatures.every(s=>s.every(b=>b===0)));
});
