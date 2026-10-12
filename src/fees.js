import {PublicKey, SystemProgram, TransactionInstruction} from '@solana/web3.js';
import {NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction} from '@solana/spl-token';
import sdk from './sdk.cjs';
import {ApiError} from './http.js';

export const FEE_BPS = 25;
export const FEE_RECIPIENT = new PublicKey('54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv');
export const FEE_ATA = getAssociatedTokenAddressSync(NATIVE_MINT, FEE_RECIPIENT);
export const feeFor = lamports => lamports * BigInt(FEE_BPS) / 10000n;

export function routerConfig(env, required = false) {
  if (!env.FEE_ROUTER_PROGRAM_ID) {
    if (required) throw new ApiError(503, 'FEE_ROUTER_NOT_DEPLOYED', 'Deploy and verify the fee router, then configure its program ID. Fee-bearing builds are unavailable until then.');
    return null;
  }
  try {
    const id = new PublicKey(env.FEE_ROUTER_PROGRAM_ID);
    if ([SystemProgram.programId, TOKEN_PROGRAM_ID, sdk.pump.PUMP_PROGRAM_ID, sdk.swap.PUMP_AMM_PROGRAM_ID, FEE_RECIPIENT].some(p => p.equals(id))) throw new Error();
    return id;
  } catch { throw new ApiError(503, 'INVALID_ROUTER_CONFIG', 'The configured fee router program ID is invalid.'); }
}

export function feeDisclosure(state, input, quote) {
  const estimated = feeFor(input.action === 'buy' ? input.amount : quote.quotedOut);
  return {
    serviceFeeBps: FEE_BPS, feeRecipient: FEE_RECIPIENT.toBase58(),
    feeAsset: state.venue === 'pump' ? 'SOL' : 'WSOL',
    feeCollection: 'atomic_actual_balance_delta',
    estimatedServiceFeeLamports: estimated.toString(),
    ...(input.action === 'buy' ? {maxServiceFeeLamports: estimated.toString()} : {minNetOut: (quote.minOut - feeFor(quote.minOut)).toString(), expectedNetOut: (quote.quotedOut - estimated).toString()}),
    feeEstimateIsFinal: false,
  };
}

// Called only after the ordinary SDK instruction audit. Only the exact trade is
// wrapped; ATA creation, SOL wrapping, volume initialization and rent stay outside.
export function wrapWithFee(ixs, input, state, quote, programId) {
  if (input.user.equals(FEE_RECIPIENT)) throw new ApiError(422, 'FEE_RECIPIENT_IS_TRADER', 'Use a trading wallet distinct from the fee recipient.');
  const native = state.venue === 'pump';
  const tradeProgram = native ? sdk.pump.PUMP_PROGRAM_ID : sdk.swap.PUMP_AMM_PROGRAM_ID;
  const coder = native ? sdk.pump.PUMP_SDK.offlinePumpProgram.coder.instruction : sdk.swap.PUMP_AMM_SDK.offlineProgram.coder.instruction;
  const userQuote = native ? input.user : getAssociatedTokenAddressSync(NATIVE_MINT, input.user);
  let wrapped = 0;
  const result = ixs.map(ix => {
    if (!native && input.action === 'buy' && ix.programId.equals(SystemProgram.programId)) {
      return SystemProgram.transfer({fromPubkey: input.user, toPubkey: userQuote, lamports: input.amount + feeFor(input.amount)});
    }
    if (!ix.programId.equals(tradeProgram) || ['extendAccount', 'initUserVolumeAccumulator'].includes(coder.decode(ix.data)?.name)) return ix;
    wrapped++;
    const prefix = [
      {pubkey: input.user, isSigner: true, isWritable: true},
      {pubkey: FEE_RECIPIENT, isSigner: false, isWritable: native},
      {pubkey: state.curveKey, isSigner: false, isWritable: false},
      {pubkey: input.mint, isSigner: false, isWritable: false},
      {pubkey: userQuote, isSigner: false, isWritable: true},
      {pubkey: native ? FEE_RECIPIENT : FEE_ATA, isSigner: false, isWritable: true},
      {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      {pubkey: tradeProgram, isSigner: false, isWritable: false},
    ];
    const masks = ix.keys.map(k => (k.isSigner ? 1 : 0) | (k.isWritable ? 2 : 0));
    return new TransactionInstruction({programId, keys: [...prefix, ...ix.keys], data: Buffer.concat([Buffer.from([1, native ? 0 : 1, input.action === 'buy' ? 0 : 1, ix.keys.length, ...masks]), ix.data])});
  });
  if (wrapped !== 1) throw new ApiError(500, 'TRANSACTION_REJECTED', 'Exactly one audited trade must be wrapped.');
  if (!native) result.unshift(createAssociatedTokenAccountIdempotentInstruction(input.user, FEE_ATA, FEE_RECIPIENT, NATIVE_MINT));
  return result;
}
