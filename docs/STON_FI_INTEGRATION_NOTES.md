# STON.fi market rates for internal exchange

## Scope

Gramup uses STON.fi only as a read-only market-rate source. GRAM and USDT conversions are internal accounting operations that atomically debit and credit the user's Gramup balances. No STON.fi router, simulation, SDK transaction, TonConnect approval, or on-chain swap is created by the exchange flow.

## Official sources

- STON.fi REST API: https://docs.ston.fi/developer-section/dex/api.md
- STON.fi API reference: https://docs.ston.fi/developer-section/dex/api/reference.md
- Official API client: https://github.com/ston-fi/api

## Verified market data

The backend reads asset metadata from `https://api.ston.fi` for the TON-native GRAM address `EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c` and TON USDT master `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`. It uses the live DEX USD prices returned by the API and derives `GRAM/USDT` and `USDT/GRAM` rates.

## Runtime behavior

`GET /api/ston/rates` returns the current read-only market snapshot. `POST /api/ston/quote` returns a short-lived, rate-derived internal quote; it does not call swap simulation. `POST /api/points/exchange` is the only execution path and atomically updates internal balances. For GRAM ↔ USDT it fetches a fresh STON.fi market snapshot on the server immediately before the accounting transaction, validates the source balance, and records both ledger legs. UP pairs retain their existing configured internal rate.

The frontend displays live GRAM and USDT prices, derives the direct rate, refreshes the internal quote on input changes, and submits all exchange pairs to `/api/points/exchange`. Wallet connection and TonConnect remain available for deposits and withdrawals, but are not involved in internal exchange.
