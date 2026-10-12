// OPTIONAL operator setup; the default Jupiter service creates the fee account
// automatically in the first successful trade. This helper is only for operators
// who choose to fund that account beforehand. It reads the chain and returns one unsigned ATA-creation
// transaction. It never signs, sends SOL, wraps SOL, approves spending or trades.
import {SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,ACCOUNT_SIZE,unpackAccount,createAssociatedTokenAccountIdempotentInstruction} from '@solana/spl-token';
import {FEE_RECIPIENT,FEE_ATA} from '../src/fees.js';

export async function buildFeeWalletSetup(connection){
  const [wallet,tokenAccount]=await connection.getMultipleAccountsInfo([FEE_RECIPIENT,FEE_ATA],'confirmed');
  if(tokenAccount){
    const account=unpackAccount(FEE_ATA,tokenAccount,TOKEN_PROGRAM_ID);
    if(!account.owner.equals(FEE_RECIPIENT)||!account.mint.equals(NATIVE_MINT)||!account.isInitialized||account.isFrozen||!account.isNative) throw new Error('The existing receiving account is invalid.');
    return {alreadyInitialized:true,feeRecipient:FEE_RECIPIENT.toBase58(),wsolAccount:FEE_ATA.toBase58(),submitted:false};
  }
  if(wallet&&(!wallet.owner.equals(SystemProgram.programId)||wallet.executable||wallet.data.length||!Number.isSafeInteger(wallet.lamports))) throw new Error('The fee recipient must be a normal SOL wallet.');
  const [walletRent,tokenRent,latest]=await Promise.all([
    connection.getMinimumBalanceForRentExemption(0,'confirmed'),
    connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE,'confirmed'),
    connection.getLatestBlockhash('confirmed')
  ]);
  if(![walletRent,tokenRent].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('Invalid rent estimate.');
  const instruction=createAssociatedTokenAccountIdempotentInstruction(FEE_RECIPIENT,FEE_ATA,FEE_RECIPIENT,NATIVE_MINT);
  const message=new TransactionMessage({payerKey:FEE_RECIPIENT,recentBlockhash:latest.blockhash,instructions:[instruction]}).compileToV0Message();
  const network=(await connection.getFeeForMessage(message,'confirmed')).value;
  if(!Number.isSafeInteger(network)||network<0)throw new Error('Network fee estimate is unavailable.');
  const needed=BigInt(walletRent)+BigInt(tokenRent)+BigInt(network);
  const balance=BigInt(wallet?.lamports??0);
  if(balance<needed)return {ready:false,requiredWalletBalanceLamports:needed.toString(),additionalFundingLamports:(needed-balance).toString(),submitted:false};
  const transaction=new VersionedTransaction(message);
  return {ready:true,transaction:Buffer.from(transaction.serialize()).toString('base64'),requiredSigner:FEE_RECIPIENT.toBase58(),wsolAccount:FEE_ATA.toBase58(),estimatedAccountRentLamports:String(tokenRent),estimatedNetworkFeeLamports:String(network),...latest,unsigned:true,submitted:false};
}
