# Automatic trading inside your bot

Start the [local API with your own RPC](CUSTOMER-RPC.md) before using these examples. The public host serves documentation only.

Use `executeTrade()` when your bot should build, check, sign, submit and track a trade in one function call. Your signer runs on your machine. Your local API receives public trade parameters, never a wallet key. An automated bot signer needs no operator approval; an interactive browser or hardware wallet can still ask its owner to approve a signature.

The service fee stays **0.25%**. No customer API key is needed. This helper supports the default Jupiter route for SOL-paired Pump bonding curves and canonical graduated PumpSwap pools. It is a Node 22+ repository example, not a separately published npm package or a hosted signing endpoint.

## Add it to an existing bot

Clone this repository and run `npm ci --ignore-scripts`. Import the helper from your bot, using your existing wallet integration and a reliable Solana mainnet RPC. The following function does nothing until your bot calls it. It deliberately does not load a secret key or run a demonstration trade.

```js
import {Connection} from '@solana/web3.js';
import {executeTrade} from './examples/execute-trade.mjs';
import {FileTradeJournal} from './examples/file-journal.mjs';

const connection = new Connection(process.env.CUSTOMER_RPC_URL, 'confirmed');
const journal = new FileTradeJournal('./.trade-journal');
const settings = {
  baseUrl: 'http://127.0.0.1:8787',
  connection,
  maxNetworkFeeLamports: '50000', // 0.00005 SOL, checked against the build estimate.
  maxFeeAccountSetupRentLamports: '2000000' // Allow up to 0.002 SOL for first-use fee-account rent.
};

export async function buyFromBot(wallet, mint, strategyOrderId) {
  const result = await executeTrade(settings, {
    publicKey: wallet.publicKey.toBase58(),
    mint,
    action: 'buy',
    amount: '0.01',              // SOL, including the service fee.
    pool: 'auto',
    slippageBps: 100,           // 1% price tolerance.
    maxServiceFeeBps: 25,       // 0.25% service-fee ceiling.
    priorityFee: 5000           // Lamports; separate from the service fee.
  }, {
    operationId: strategyOrderId,
    journal,
    signTransaction: transaction => wallet.signTransaction(transaction)
  });

  if (result.status === 'confirmed') {
    console.log('Confirmed:', result.signature);
  } else {
    // Save this outcome in your strategy. Do not generate a replacement order ID
    // just because the result is pending or unknown.
    console.log(result.status, result.signature, result.reason);
  }
  return result;
}
```

`wallet` must expose `publicKey` and `signTransaction(transaction)`, returning the signed `VersionedTransaction`. Use a **sign-only** callback; it must not broadcast on its own. The helper verifies the signature and refuses a changed transaction. Configure automated spending limits in your strategy; this helper does not implement a strategy, balance manager or daily loss limit.

For a sell, change `action` to `sell` and pass an integer string of raw token units. For example, `amount: '1000000'` is one token with six decimals. Other settings and execution handling are the same.

## Keep the same ID when recovering

Use your strategy's persistent order ID, such as `position-842-entry`, for `operationId`. Every process handling that order must use the same journal directory. A repeat call with that ID only checks the saved signature; it never builds, signs or submits another transaction. Reusing the ID for different order parameters is rejected.

The journal reserves the ID before building and flushes the signature to a local file before broadcasting. It stores a fingerprint and public receipt, not wallet secrets or signed transaction bytes. Keep the directory persistent, private and out of Git. Do not delete it or use a new random ID to make a retry work. The included implementation is for a bot on one machine with local disk, not separate servers, ephemeral containers, network filesystems or a database with disaster recovery. A multi-host bot needs its own shared transactional journal implementing atomic `reserve(id, fingerprint)` and persistent `save(id, record)` before submission.

An interrupted reservation without a saved signature stays `pending`. The helper will not guess whether another process is still working. Resolve the original worker/journal before creating a replacement. Normal execution is automatic; uncertain crash recovery can require investigation.

| Result | Meaning and next action |
| --- | --- |
| `confirmed` | RPC reports confirmed or finalized execution with no error. Record the fill using that signature; confirmation is not the same as finality. |
| `failed` | RPC reports a confirmed/finalized execution error. No successful swap; network fees can still apply. Review the error before a new intent. |
| `not_submitted` | This invocation stopped before broadcasting. Fix the stated cause; the original ID remains reserved. |
| `pending` | That ID was already reserved without a saved signature. Do not start a competing replacement. |
| `unknown` | A submission may have landed. Keep the signature and reconcile it; do not treat this as failure and place another trade. |

`acknowledged: true` only means the submission RPC returned the expected signature. It does not prove a trade succeeded. An expired blockhash with missing transaction history still returns `unknown`, because one provider's missing result is not proof of non-execution. These distinctions follow [Solana's submission contract](https://solana.com/docs/rpc/http/sendtransaction) and [signature status lookup](https://solana.com/docs/rpc/http/getsignaturestatuses).

To check later without signing or sending anything:

```js
import {trackTrade} from './examples/execute-trade.mjs';
const receipt = await journal.read(strategyOrderId);
if (receipt.signature) {
  const status = await trackTrade(settings, receipt);
  console.log(status.status, status.signature);
}
```

The default tracking window is 45 seconds with an 800 ms poll interval. RPC calls and signing each have bounded waits. `settings.signal` can stop before submission or end tracking; cancelling after broadcast cannot cancel an on-chain transaction. A later `trackTrade` call is read-only. The helper does not automatically change blockhashes, reroute signed trades or create replacement signatures. The RPC may retry the **same bytes**, with `maxRetries: 2`.

## Checks and cost limits

Before signing, the helper requires successful API simulation, checks encoded amounts, slippage, the 25-bps fee and recipient, validates the supported protocol and canonical market, and reconstructs every outer instruction. Unexpected transfers, programs, compute budgets or account cleanup fail. It checks current WSOL account existence and block height through your RPC, then checks expiry again after signing. Submission keeps `skipPreflight: false` and uses confirmed commitment.

`maxFeeAccountSetupRentLamports` defaults to `'0'`: the helper refuses a build that reports new fee-account rent until you explicitly allow it. The example allows `'2000000'`. `maxNetworkFeeLamports` defaults to `'50000'`. These two limits check **reported estimates**, not an on-chain cap on every possible account-rent cost. Other trader/protocol accounts can need rent. The encoded priority fee and service fee are checked separately. Use a trusted API and RPC, review the cost report, and have your signer apply any additional policy automatically through its second callback argument: `{order, response}`.

This is not an independent audit of Jupiter's inner calls or a guarantee against third-party program changes. The server validates chain state and simulates the protocol; the client adds checks at the signing boundary. Simulation and expiry checks cannot prevent every price change or graduation race.

Supported Jupiter variants are 187/191 for curve buys, 192 for curve sells, and 193/194 for PumpSwap buys/sells. The canonical writable market must occupy the reviewed account position; appending it elsewhere is rejected. Legacy curve-sell variant 153 is rejected because its exact account layout has not been verified. An upstream layout change can therefore produce `ROUTE_REJECTED` until reviewed. See [the review record](REVIEW.md) for evidence and limitations.

## Speed and current limits

This removes manual orchestration inside a bot; it does not guarantee subsecond confirmation. `timings.buildAndInspectMs`, `signMs`, `submitMs`, and `trackingMs` distinguish the stages. A timeout contributes to submission time and is not a measured acknowledgement. Recovered calls report tracking time only.

Reuse a healthy RPC connection near your bot. Request the build when ready to sign, choose a bounded priority fee, and respect your RPC and routing-provider limits. Independent order IDs can execute concurrently; your strategy must manage wallet balances and positions.

No Jito tips, bundles, hosted wallets, token creation or WebSocket feed are added here. Those require separate implementation and validation. The current helper was tested with synthetic local signatures and mocked transports, plus existing unsigned builder fixtures. **No live trade was signed, submitted or used as a latency benchmark.** See [performance](PERFORMANCE.md) and [review](REVIEW.md).
