import sdk from '../src/sdk.cjs';
import BN from 'bn.js';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,NATIVE_MINT,MintLayout,AccountLayout,getAssociatedTokenAddressSync} from '@solana/spl-token';
const {PUMP_SDK,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,bondingCurvePda,canonicalPumpPoolPda} = sdk.pump;
const {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,pumpPoolAuthorityPda} = sdk.swap;
export const USER=new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
export const MINT=new PublicKey('6nTDSkevucpPhzhhDa6n3Gpye92HYuVq2ZiK4Xs8pump');
export const OTHER=new PublicKey('62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV');
export const BLOCKHASH=OTHER.toBase58();
export const ROUTER=new PublicKey('CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8');
export const ENV={FEE_ROUTER_PROGRAM_ID:ROUTER.toBase58()};
const bn=x=>new BN(String(x));
function zero(type,idl){
 if(type==='pubkey')return PublicKey.default;if(type==='bool')return false;
 if(['u64','u128','i64','i128','u256','i256'].includes(type))return bn(0);
 if(typeof type==='string')return 0;
 if(type.array)return Array.from({length:type.array[1]},()=>zero(type.array[0],idl));
 if(type.vec)return [];if(type.option)return null;
 if(type.defined){const def=idl.types.find(t=>t.name===type.defined.name).type;return Object.fromEntries(def.fields.map(f=>[f.name,zero(f.type,idl)]));}
 throw new Error('Unknown fixture type '+JSON.stringify(type));
}
export function blank(program,name){return zero({defined:{name}},program.idl);}
const info=(data,owner)=>({data,owner,lamports:10000000,executable:false});
async function encoded(program,name,value,owner,min=0){const {layout,discriminator}=program.coder.accounts.accountLayouts.get(name);const buffer=Buffer.alloc(20000);const size=layout.encode(value,buffer);const data=Buffer.concat([Buffer.from(discriminator),buffer.subarray(0,size)]);return info(data.length<min?Buffer.concat([data,Buffer.alloc(min-data.length)]):data,owner);}
function mintInfo(){const data=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);return info(data,TOKEN_PROGRAM_ID);}
export function tokenInfo(mint,owner,amount){const data=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint,owner,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:mint.equals(NATIVE_MINT)?1:0,isNative:2039280n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},data);return info(data,TOKEN_PROGRAM_ID);}
export async function fixture({graduated=false,cashback=false,existingWsol=false,virtualQuote='0'}={}){
 const p=PUMP_SDK.offlinePumpProgram,a=PUMP_AMM_SDK.offlineProgram;
 const curveKey=bondingCurvePda(MINT),poolKey=canonicalPumpPoolPda(MINT),accounts=new Map();
 const set=(key,value)=>accounts.set(key.toBase58(),value);
 set(ROUTER,{data:Buffer.alloc(0),owner:new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),lamports:1,executable:true});
 set(sdk.pump.userVolumeAccumulatorPda(USER),info(Buffer.alloc(128),PUMP_PROGRAM_ID));
 set(MINT,mintInfo());set(USER,{data:Buffer.alloc(0),owner:SystemProgram.programId,lamports:100000000000,executable:false});
 set(getAssociatedTokenAddressSync(MINT,USER,false,TOKEN_PROGRAM_ID),tokenInfo(MINT,USER,500000000000n));
 const curve={...blank(p,'bondingCurve'),virtualTokenReserves:bn('1073000000000000'),virtualQuoteReserves:bn('30000000000'),realTokenReserves:bn('793100000000000'),realQuoteReserves:bn('20000000000'),tokenTotalSupply:bn('1000000000000000'),creator:OTHER,complete:graduated,isCashbackCoin:cashback};
 set(curveKey,await encoded(p,'bondingCurve',curve,PUMP_PROGRAM_ID));
 const global={...blank(p,'global'),initialized:true,initialVirtualTokenReserves:bn('1073000000000000'),initialVirtualSolReserves:bn('30000000000'),initialRealTokenReserves:bn('793100000000000'),tokenTotalSupply:bn('1000000000000000'),feeRecipient:OTHER,buybackFeeRecipients:Array(8).fill(OTHER),feeRecipients:Array(7).fill(OTHER),reservedFeeRecipient:OTHER,poolMigrationFee:bn(15000000)};
 set(GLOBAL_PDA,await encoded(p,'global',global,PUMP_PROGRAM_ID));
 const fees={lpFeeBps:bn(20),protocolFeeBps:bn(95),creatorFeeBps:bn(30)};
 for(const [program,key] of [[p,PUMP_FEE_CONFIG_PDA],[a,PUMP_AMM_FEE_CONFIG_PDA]]){
  const f={...blank(program,'feeConfig'),flatFees:fees,feeTiers:[{marketCapLamportsThreshold:bn(0),fees}],stableFeeTiers:[],exoticFlatFees:fees};
  set(key,await encoded(program,'feeConfig',f,PUMP_FEE_PROGRAM_ID,10240));
 }
 set(getAssociatedTokenAddressSync(MINT,curveKey,true,TOKEN_PROGRAM_ID),tokenInfo(MINT,curveKey,1000000000000000n));
 if(graduated){
  const baseVault=getAssociatedTokenAddressSync(MINT,poolKey,true,TOKEN_PROGRAM_ID),quoteVault=getAssociatedTokenAddressSync(NATIVE_MINT,poolKey,true,TOKEN_PROGRAM_ID);
  const pool={...blank(a,'pool'),index:0,creator:pumpPoolAuthorityPda(MINT),baseMint:MINT,quoteMint:NATIVE_MINT,poolBaseTokenAccount:baseVault,poolQuoteTokenAccount:quoteVault,coinCreator:OTHER,isCashbackCoin:cashback,virtualQuoteReserves:bn(virtualQuote)};
  set(poolKey,await encoded(a,'pool',pool,PUMP_AMM_PROGRAM_ID));
  const config={...blank(a,'globalConfig'),protocolFeeRecipients:Array(8).fill(OTHER),buybackFeeRecipients:Array(8).fill(OTHER),lpFeeBasisPoints:bn(20),protocolFeeBasisPoints:bn(95),coinCreatorFeeBasisPoints:bn(30)};
  set(GLOBAL_CONFIG_PDA,await encoded(a,'globalConfig',config,PUMP_AMM_PROGRAM_ID));
  set(baseVault,tokenInfo(MINT,poolKey,300000000000000n));set(quoteVault,tokenInfo(NATIVE_MINT,poolKey,80000000000n));
 }
 if(existingWsol)set(getAssociatedTokenAddressSync(NATIVE_MINT,USER,false,TOKEN_PROGRAM_ID),tokenInfo(NATIVE_MINT,USER,1000000000n));
 const rpc={slot:100,calls:0,accounts:async keys=>{rpc.calls++;return keys.map(k=>accounts.get(k.toBase58())??null);},latestBlockhash:async()=>{rpc.calls++;return {blockhash:BLOCKHASH,lastValidBlockHeight:300};},fee:async()=>{rpc.calls++;return 5000;},simulate:async()=>{rpc.calls++;return {err:null,unitsConsumed:70000};}};
 return {rpc,accounts,curve,poolKey,curveKey};
}
export const buy={publicKey:USER.toBase58(),mint:MINT.toBase58(),action:'buy',amount:'0.01',simulate:false};
export const sell={...buy,action:'sell',amount:'1000000000'};
