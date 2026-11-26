# STON.fi live rates and swaps

## Scope

Gramup uses the TON-native asset exposed by STON.fi as `GRAM` and canonical TON USDT as the second DEX asset. The integration keeps the existing internal UP/GRAM/USDT accounting flow intact and adds a separate wallet-confirmed STON.fi DEX path for real GRAM/USDT swaps.

## Official sources

- STON.fi REST API overview: https://docs.ston.fi/developer-section/dex/api.md
- STON.fi API reference: https://docs.ston.fi/developer-section/dex/api/reference.md
- STON.fi DEX v2 swap guide: https://docs.ston.fi/developer-section/dex/sdk/swap.md
- STON.fi DEX v2 setup and environments: https://docs.ston.fi/developer-section/dex/sdk/v2.md
- STON.fi transaction sending: https://docs.ston.fi/developer-section/common/transaction-sending.md
- Official API client source: https://github.com/ston-fi/api
- Official SDK source: https://github.com/ston-fi/sdk

## Verified protocol facts

- REST base URL is `https://api.ston.fi`.
- Direct quote endpoint is `POST /v1/swap/simulate`. The API client sends `offer_address`, `ask_address`, `units`, and `slippage_tolerance` as URL query parameters.
- A simulation returns `ask_units`, `min_ask_units`, `recommended_min_ask_units`, `router`, `gas_params`, `price_impact`, and `swap_rate`.
- Mainnet asset address for native GRAM/Ton is `EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c`, with 9 decimals.
- Mainnet USDT master is `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`, with 6 decimals.
- STON.fi recommends feeding `simulation.router` into `dexFactory()` and reusing the returned simulation amounts when building the transaction.
- For TON/jetton swaps, the SDK uses `getSwapTonToJettonTxParams` or `getSwapJettonToTonTxParams`; the resulting `{to, value, body}` maps to one TonConnect message with `address`, `amount`, and base64 `payload`.
- Slippage values are fractional, so `0.01` is 1%.

## Live API smoke-test evidence

On 2026-11-26, the STON.fi API returned HTTP 200 for the asset catalog and direct simulations. A 1 GRAM simulation returned a live ask amount in USDT base units and a router object. A 1 USDT simulation returned a live ask amount in GRAM base units and a router object. Quotes are therefore amount-specific and are refreshed immediately before execution.

## Integration decisions

- Server-side route `/api/ston/rates` proxies the two canonical asset metadata records and returns live DEX/USD prices plus a derived GRAM/USDT ratio.
- Server-side route `/api/ston/quote` simulates a requested GRAM/USDT amount and returns the exact output/minimum output and expiry metadata.
- Server-side route `/api/ston/swap/transaction` re-simulates and builds a current STON.fi transaction using the verified TON wallet bound to the authenticated Gramup user. The client only submits that transaction after the user confirms it in their wallet.
- The client refreshes market metadata when the exchange modal opens and re-quotes as the amount or pair changes. Existing UP/internal balance swaps remain unchanged; actual STON.fi execution is reserved for GRAM <-> USDT.
