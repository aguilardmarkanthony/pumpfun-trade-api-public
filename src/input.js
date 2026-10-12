import {PublicKey} from '@solana/web3.js';
import {ApiError,fail,object,integer} from './http.js';
import {FEE_BPS} from './fees.js';
export const U64_MAX = (1n << 64n) - 1n;
export function publicKey(value, name = 'mint', signer = false) {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) fail(`${name} must be a base58 Solana public key.`);
  let key; try { key = new PublicKey(value); } catch { fail(`${name} must be a base58 Solana public key.`); }
  if (key.toBase58() !== value || key.equals(PublicKey.default) || (signer && !PublicKey.isOnCurve(key.toBytes()))) fail(`${name} must be a valid ${signer ? 'signing wallet' : 'mint'} public key.`);
  return key;
}
export function amountUnits(value, action) {
  // Legacy JSON numbers remain accepted only when they represent a safe exact unit count.
  if (typeof value === 'number') {
    const units = action === 'buy' ? value * 1e9 : value;
    if (!Number.isFinite(value) || !Number.isSafeInteger(units)) fail('Use a decimal string for exact amounts.');
    value = action === 'buy' ? (BigInt(units) / 1000000000n).toString() + '.' + (BigInt(units) % 1000000000n).toString().padStart(9,'0') : String(units);
  }
  if (typeof value !== 'string' || value.length > 30) fail('amount must be an exact decimal string.');
  const pattern = action === 'buy' ? /^(0|[1-9]\d{0,10})(?:\.(\d{1,9}))?$/ : /^(0|[1-9]\d{0,19})$/;
  const match = pattern.exec(value); if (!match) fail(action === 'buy' ? 'Buy amount is SOL, up to nine decimal places.' : 'Sell amount is an integer count of raw token units.');
  const result = action === 'buy' ? BigInt(match[1])*1000000000n + BigInt((match[2]??'').padEnd(9,'0')) : BigInt(value);
  if (result <= 0n || result > U64_MAX || (action === 'buy' && result > 100000000000n)) fail('Amount must be positive, fit u64, and buys are limited to 100 SOL per build.');
  return result;
}
export function tradeInput(body) {
  object(body,['publicKey','mint','action','amount','denominatedInSol','slippage','slippageBps','priorityFee','pool','simulate','maxServiceFeeBps']);
  if (!['buy','sell'].includes(body.action)) fail('action must be buy or sell.');
  const user = publicKey(body.publicKey,'publicKey',true), mint = publicKey(body.mint);
  if (body.denominatedInSol !== undefined && body.denominatedInSol !== (body.action === 'buy')) fail('Buy amounts are SOL; sell amounts are raw token units.');
  if (body.slippage !== undefined && body.slippageBps !== undefined) fail('Use slippage or slippageBps, not both.');
  let slippageBps = integer(body.slippageBps,'slippageBps',1,5000,100);
  if (body.slippage !== undefined) {
    if (typeof body.slippage !== 'number' || !Number.isFinite(body.slippage) || Math.abs(body.slippage*100-Math.round(body.slippage*100))>1e-8) fail('slippage is a percentage with at most two decimals.');
    slippageBps=integer(Math.round(body.slippage*100),'slippage in basis points',1,5000);
  }
  const pool = body.pool ?? 'auto';
  if (pool === 'raydium') throw new ApiError(422,'UNSUPPORTED_VENUE','This replacement supports Pump bonding curves and canonical PumpSwap pools; Raydium is not implemented.');
  if (!['auto','pump','pumpswap'].includes(pool)) fail('pool must be auto, pump or pumpswap.');
  if (body.simulate !== undefined && typeof body.simulate !== 'boolean') fail('simulate must be boolean.');
  const input={user,mint,action:body.action,amount:amountUnits(body.amount,body.action),slippageBps,pool,priorityFee:integer(body.priorityFee,'priorityFee',0,10000000,0),simulate:body.simulate??true,maxServiceFeeBps:integer(body.maxServiceFeeBps,'maxServiceFeeBps',0,10000)};
  if(input.maxServiceFeeBps!==undefined&&FEE_BPS>input.maxServiceFeeBps)throw new ApiError(409,'FEE_LIMIT_EXCEEDED',`The service fee is ${FEE_BPS} basis points, above your maxServiceFeeBps limit. Review the fee before changing your limit.`);
  return input;
}
export function minimumOut(expected, bps) {
  const min = expected * BigInt(10000-bps) / 10000n;
  if (min <= 0n || min > U64_MAX || expected > U64_MAX) throw new ApiError(422,'AMOUNT_TOO_SMALL','Amount has no positive minimum output at this slippage.');
  return min;
}
