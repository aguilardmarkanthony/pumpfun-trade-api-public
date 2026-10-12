import {FEE_BPS} from './fees.js';

// Published identity is fixed: request headers and query strings must not enter HTML.
export const PUBLIC_ORIGIN = 'https://pump-trade-router.apilabph.workers.dev';
const REPOSITORY = 'https://github.com/apilabph/pumpfun-trade-api-public';
const feePercent = FEE_BPS / 100;
const title = 'Pumpfun Buy Sell API for Solana & PumpSwap | API Lab PH';
const description = `Build unsigned Pump.fun buy and sell transactions with automatic bonding-curve and PumpSwap routing. No customer API key. Transparent ${feePercent}% service fee.`;
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const buy = {publicKey:'YOUR_PUBLIC_WALLET',mint:'TOKEN_MINT',action:'buy',amount:'0.01',pool:'auto',slippageBps:100,maxServiceFeeBps:FEE_BPS};
const sell = {...buy,action:'sell',amount:'1000000'};
const requestExample = `curl ${PUBLIC_ORIGIN}/api/quote \\\n  -H "Content-Type: application/json" \\\n  --data '${JSON.stringify(buy)}'`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
  <link rel="canonical" href="${PUBLIC_ORIGIN}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${PUBLIC_ORIGIN}/">
  <meta name="color-scheme" content="light">
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182c29;background:#f7f8f5;line-height:1.65}
    *{box-sizing:border-box}body{margin:0}a{color:#08614f;text-underline-offset:4px}a:hover{color:#043b30}a:focus-visible{outline:3px solid #d68b24;outline-offset:4px}
    .wrap{max-width:1040px;margin:auto;padding:0 28px}.skip{position:absolute;left:16px;top:-60px;background:white;padding:8px}.skip:focus{top:8px}
    header{border-bottom:1px solid #d9e0d7}.nav{display:flex;justify-content:space-between;align-items:center;gap:24px;padding-top:22px;padding-bottom:22px}.brand{font-weight:750;letter-spacing:.04em;text-decoration:none}.nav nav{display:flex;gap:24px;flex-wrap:wrap;font-size:.92rem}
    .hero{padding:76px 0 58px;max-width:840px}.eyebrow{font-size:.8rem;letter-spacing:.13em;text-transform:uppercase;color:#47645a;font-weight:700}h1{font-size:clamp(2.5rem,6.5vw,4.8rem);line-height:1.08;letter-spacing:-.05em;margin:16px 0 24px;font-weight:750}h2{font-size:1.7rem;letter-spacing:-.025em;line-height:1.25;margin:0 0 20px}h3{font-size:1.05rem;margin:0 0 8px}.lede{font-size:1.2rem;max-width:720px;color:#43564f}.actions{display:flex;gap:14px;flex-wrap:wrap;margin:28px 0 20px}.button{display:inline-block;background:#125c48;color:white;padding:11px 19px;border-radius:5px;font-weight:650;text-decoration:none}.button:hover{color:white;background:#0a4434}.secondary{background:transparent;color:#125c48;border:1px solid #b7c9bd}.secondary:hover{background:#e4eee5;color:#125c48}.small{font-size:.9rem;color:#4b6258}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;padding:28px 0;border-top:1px solid #d9e0d7;border-bottom:1px solid #d9e0d7}.facts p{margin:0;font-size:.95rem;color:#43564f}section{padding:44px 0;border-bottom:1px solid #d9e0d7}section p{max-width:820px}pre{padding:22px;background:#142c25;color:#edf5e8;border-radius:6px;overflow:auto;font-size:.85rem;line-height:1.65}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}p code,li code,dd code{background:#e9eee5;padding:2px 5px;border-radius:3px;overflow-wrap:anywhere}.steps{padding-left:22px}.steps li{margin:14px 0}.columns{display:grid;grid-template-columns:1fr 1fr;gap:36px}.cost{border-left:3px solid #b5791e;padding:2px 0 2px 20px}dt{font-weight:700;margin-top:24px}dd{margin:8px 0 0;max-width:820px}.resources{display:flex;flex-wrap:wrap;gap:14px 26px}footer{padding:30px 0 46px;font-size:.9rem;color:#4b6258}footer p{max-width:800px}.endpoint{overflow-wrap:anywhere}
    @media(max-width:640px){.wrap{padding:0 20px}.nav{align-items:flex-start;gap:16px}.nav nav{gap:12px}.hero{padding:46px 0 34px}.facts,.columns{grid-template-columns:1fr;gap:22px}section{padding:32px 0}pre{padding:16px}.actions a{width:100%;text-align:center}}
  </style>
</head>
<body>
<a class="skip" href="#main">Skip to documentation</a>
<header><div class="wrap nav"><a class="brand" href="/">API LAB PH</a><nav aria-label="Main"><a href="#quickstart">Quickstart</a><a href="#fees">Fees</a><a href="${REPOSITORY}">GitHub</a></nav></div></header>
<main id="main" class="wrap">
  <div class="hero">
    <p class="eyebrow">Pump Trade Router / Public beta</p>
    <h1>Pumpfun buy &amp; sell API.<br>Know the route before you sign.</h1>
    <p class="lede">Build Pump.fun trades on Solana with automatic routing between bonding curves and graduated PumpSwap tokens. Get a simulated, unsigned transaction that your wallet or bot can inspect and sign.</p>
    <div class="actions"><a class="button" href="#quickstart">Make your first request</a><a class="button secondary" href="${REPOSITORY}">Explore the source</a></div>
    <p class="small">No customer API key or signup. ${feePercent}% service fee on successful trades. Network fees, protocol fees and account rent are separate.</p>
  </div>
  <div class="facts" aria-label="API capabilities">
    <div><h3>One request, the right market</h3><p>Chain-state checks select a Pump bonding curve or the canonical SOL-paired PumpSwap pool.</p></div>
    <div><h3>Inspect before signing</h3><p>Builds include simulation results, minimum output, fees, account setup rent and transaction expiry.</p></div>
    <div><h3>Your wallet keeps control</h3><p>The API never receives a private key, signs a transaction or broadcasts a trade.</p></div>
  </div>
  <section id="quickstart">
    <p class="eyebrow">Start with a quote</p><h2>A first request in curl</h2>
    <p class="endpoint">Public API: <code>${PUBLIC_ORIGIN}</code></p>
    <p>Replace <code>YOUR_PUBLIC_WALLET</code> with the trader's public Solana address and <code>TOKEN_MINT</code> with a token mint address, not a ticker. This request asks for a quote using a 0.01 SOL buy budget. It does not execute a trade or collect a fee.</p>
    <pre><code>${escape(requestExample)}</code></pre>
    <p class="small">On Windows PowerShell, use <code>curl.exe</code> and put the command on one line. Amounts are strings to preserve precision.</p>
    <ol class="steps">
      <li><strong>Get a quote.</strong> POST to <code>/api/quote</code>. Read the selected <code>venue</code>, <code>expectedOut</code> and <code>minOut</code>.</li>
      <li><strong>Build the transaction.</strong> Send the same request to <code>/api/trade/local</code>. The builder requires successful unsigned simulation and rechecks the market stage before returning.</li>
      <li><strong>Review and sign locally.</strong> Show the fee, rent, output limits and expiry. Use your wallet integration to sign and submit. The <a href="${REPOSITORY}/blob/main/examples/client.mjs">JavaScript client example</a> checks the encoded signer, service fee, recipient, amounts and slippage.</li>
    </ol>
  </section>
  <section id="sell">
    <h2>How to sell a Pump.fun token</h2>
    <p>Use <code>action: "sell"</code> and an integer string in raw token units. For a token with six decimals, <code>"1000000"</code> means one token. Send this JSON to the same quote or build endpoint:</p>
    <pre><code>${escape(JSON.stringify(sell,null,2))}</code></pre>
    <p>The response's <code>expectedOut</code> and <code>minOut</code> already account for the service fee. Existing wrapped-SOL accounts stay open, so proceeds may remain wrapped SOL. See the <a href="${REPOSITORY}/blob/main/docs/USAGE.md">buy and sell integration guide</a> for the full response and error handling.</p>
  </section>
  <section id="routing">
    <h2>Bonding curve or graduated PumpSwap token?</h2>
    <p>With <code>pool: "auto"</code>, the API reads the token's on-chain state and selects the supported market. A trade build validates the curve or canonical pool, simulates the transaction and checks the stage again.</p>
    <p>A token can still graduate after the response. If a venue changes, request a fresh build; a signed transaction cannot reroute itself. Incomplete migrations, unsupported routes and failed simulations return errors instead of an unchecked transaction. Newly created tokens may not yet be indexed by the upstream router.</p>
    <p>Current coverage is limited to SOL-paired Pump curves and canonical PumpSwap pools. Raydium, other chains, non-SOL pairs and unsupported token extensions are outside this release.</p>
  </section>
  <section id="fees">
    <h2>Fees you can check before signing</h2>
    <div class="columns"><div><h3>${feePercent}% service fee</h3><p>For a buy, the fee is included in the requested SOL budget. For a sell, it is deducted from actual SOL proceeds. Fees settle to the published recipient in wrapped SOL.</p><p>Set <code>maxServiceFeeBps: ${FEE_BPS}</code> to reject a service fee above ${feePercent}%. This limit does not cover protocol fees, network fees or rent.</p></div><div class="cost"><h3>First-use account rent</h3><p>If the service's receiving account is missing, the first trader funds its creation in the transaction. The build reports this separately before signing. Other accounts may also require rent.</p><p><a href="${REPOSITORY}/blob/main/docs/FEES.md">Fee calculations and recipient address</a></p></div></div>
  </section>
  <section id="questions">
    <h2>Before you integrate</h2>
    <dl><dt>Do I need an API key?</dt><dd>The hosted public beta needs no customer API key, signup or subscription. Rate limits apply; honor <code>Retry-After</code> when a request returns HTTP 429.</dd>
    <dt>How fast are builds?</dt><dd>Four hosted unsigned builds in the October 13, 2026 verification took 545-1,187 ms. This small sample measures building and simulation, not confirmation speed or worldwide performance. <a href="${REPOSITORY}/blob/main/docs/PERFORMANCE.md">Read the speed and verification notes</a>.</dd>
    <dt>Does simulation guarantee that my trade will land?</dt><dd>No. Prices, balances, token stages and blockhash validity can change before submission. Handle expiry and stage changes by rebuilding. Review the entire transaction before signing.</dd>
    <dt>Is this an official Pump.fun API?</dt><dd>No. Pump Trade Router is an independent API Lab PH project. It uses Jupiter's existing on-chain router and supports the specific Pump and PumpSwap routes described here.</dd></dl>
  </section>
  <section id="documentation"><h2>Build with the source open</h2><div class="resources"><a href="${REPOSITORY}/blob/main/docs/API.md">API reference</a><a href="${REPOSITORY}/blob/main/docs/openapi.json">OpenAPI schema</a><a href="${REPOSITORY}/blob/main/docs/USAGE.md">JavaScript examples</a><a href="${REPOSITORY}/blob/main/docs/REVIEW.md">Review and verification</a><a href="${REPOSITORY}/blob/main/docs/COMPARISON.md">Alternatives and trade-offs</a><a href="${REPOSITORY}/issues">Report an issue</a></div></section>
</main>
<footer class="wrap"><p><strong>API Lab PH / Pump Trade Router</strong><br>Independent open-source integration. Public beta; no uptime or execution guarantee. <a href="${REPOSITORY}/blob/main/LICENSE">MIT-licensed source</a>. Source forks can change the fee configuration.</p></footer>
</body></html>`;

const documents = new Map([
  ['/', {type:'text/html; charset=utf-8',body:html}],
  ['/robots.txt', {type:'text/plain; charset=utf-8',body:`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`}],
  ['/sitemap.xml', {type:'application/xml; charset=utf-8',body:`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${PUBLIC_ORIGIN}/</loc></url></urlset>\n`}],
]);

export function documentationResponse(request) {
  const document = documents.get(new URL(request.url).pathname);
  if (!document) return null;
  const headers = {
    'Content-Type':document.type,
    'Cache-Control':'public, max-age=300',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'Link':`<${PUBLIC_ORIGIN}/sitemap.xml>; rel="sitemap"`,
  };
  if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{...headers,'Cache-Control':'no-store',Allow:'GET, HEAD'}});
  return new Response(request.method === 'HEAD' ? null : document.body,{status:200,headers});
}
