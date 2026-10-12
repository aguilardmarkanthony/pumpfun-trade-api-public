# GitHub and Google discovery

The public quickstart is served at [the API's root address](https://pump-trade-router.apilabph.workers.dev/). It contains readable HTML, buy/sell examples, supported routing, fees, limitations and links to the source and detailed documentation. It requires no client JavaScript, login or API key. GitHub's About homepage should point here.

For a separately branded deployment, update the fixed published origin, repository links and product text in `src/discovery.js` together. Do not construct canonical URLs from an untrusted request host. The default page describes this hosted public beta, including its fee policy.

## Publication checks

- `/` returns HTTP 200 and `text/html`, with one main heading, a descriptive title and description, and a canonical URL for the published origin.
- `/robots.txt` allows the public page and references `/sitemap.xml`. It discourages crawling `/api/`; it is not authentication and does not itself prevent indexing of a linked URL.
- `/sitemap.xml` lists only the public documentation URL. Do not list transaction requests, wallet addresses or JSON error pages.
- GET and HEAD work. Other methods on these static routes return 405. User-controlled URL text is never inserted into the HTML or canonical link.
- Page requests make no RPC calls and use no API limiter capacity. Trade endpoints retain their own authentication, rate limits, fee validation and simulation requirements. Static requests still consume hosting resources.
- Check the live robots file after deployment: the hosting provider may prepend its own content signals. Verify the actual combined rules, not only the file in source.

The page does not include invented reviews, star ratings, customer numbers, or claims of official affiliation. Its timings link to a small historical build sample, not guaranteed confirmation speed. Keep fee text aligned with the shared fee constant.

## Google verification

Publishing a page and sitemap makes them available to crawlers; it does not establish indexing or a search position. Check Google Search Console for the definitive property-specific crawl/index report. A search query that does not show the page is not proof that it is absent from the index. [Google technical requirements](https://developers.google.com/search/docs/essentials/technical).

For the hosted service, add a **URL-prefix property** for `https://pump-trade-router.apilabph.workers.dev/` in the owner's [Google Search Console](https://search.google.com/search-console). Use an HTML verification file or meta tag supplied by Google. The operator must publish the exact token through a reviewed change; this project does not contain a fabricated or preassigned token. A DNS property is appropriate only for a domain the owner controls. Do not attempt to claim ownership of `workers.dev` or `github.com`.

After ownership is verified, inspect the root URL, test the live page, request indexing and submit `sitemap.xml`. Record Google's response and later inspection status separately from deployment evidence. Do not use Google's restricted Indexing API for ordinary API documentation. [Ownership verification](https://support.google.com/webmasters/answer/9008080), [requesting recrawls](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl), [sitemap submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

No Search Console ownership, sitemap submission or Google indexing is claimed by the initial documentation release. No paid SEO, domain purchase, backlink scheme or outreach is part of this change. The same reviewed public-documentation standard should apply to future API releases, with separate repositories and only implemented platform coverage.
