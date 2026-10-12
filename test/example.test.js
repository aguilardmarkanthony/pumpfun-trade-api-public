import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectBuild} from '../examples/client.mjs';
import {tradeInput} from '../src/input.js';
import {trade} from '../src/service.js';
import {fixture,buy,ENV,ROUTER,OTHER} from './fixtures.js';

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
