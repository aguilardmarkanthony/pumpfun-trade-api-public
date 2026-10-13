import { FEE_BPS, FEE_RECIPIENT } from '../src/fees.js';
import { Rpc } from '../src/rpc.js';
import { jupiterTrade } from '../src/jupiter.js';

// Runs in the customer's process. No RPC or routing credentials are sent to APILabPH.
export function createClient({ rpcUrl, jupiterApiKey, fetchImpl = fetch } = {}) {
  let parsed;
  try { parsed = new URL(rpcUrl); } catch { throw new Error('Provide your own HTTPS rpcUrl.'); }
  if (typeof rpcUrl !== 'string' || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash)
    throw new Error('Provide your own HTTPS rpcUrl without basic authentication or a fragment.');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function.');
  if (jupiterApiKey !== undefined && (typeof jupiterApiKey !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(jupiterApiKey)))
    throw new Error('jupiterApiKey must be a valid customer routing key.');
  const env = Object.freeze({ SOLANA_RPC_URL: rpcUrl, ...(jupiterApiKey ? { JUPITER_API_KEY: jupiterApiKey } : {}) });
  const run = (order, build) => jupiterTrade(
    structuredClone(order), env, build,
    settings => new Rpc(settings, fetchImpl), fetchImpl,
  );
  return Object.freeze({
    capabilities: Object.freeze({rpcMode:"customer",customerRpcRequired:true,hostedTrading:false,serviceFeeBps:FEE_BPS,feeRecipient:FEE_RECIPIENT.toBase58(),unsignedOnly:true,broadcast:false,fundedTradesTested:false}),

    quote: order => run(order, false),
    buildTrade: order => run(order, true),
  });
}
