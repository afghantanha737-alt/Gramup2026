# GramUp Wallet Integration Notes

## Phase 1 scope

Phase 1 adds the TON Connect manifest and client connection flow. The connected account address is synchronized with the authenticated GramUp user and the withdrawal UI uses that address instead of asking the user to type an address. Existing manual withdrawal API compatibility is retained for a controlled rollout; when a connected wallet exists, the server rejects a different address.

No external payment is sent in Phase 1. Deposit-to-Swap automation remains disabled until the transaction intent, TON proof, chain confirmation, and idempotent crediting flow are implemented and tested.

## Official references

- TON Connect setup and vanilla JavaScript API: https://docs.ton.org/applications/ton-connect/get-started
- TON Connect core concepts and manifest requirements: https://docs.ton.org/applications/ton-connect/core-concepts
- TON proof verification requirements: https://docs.ton.org/applications/ton-connect/how-to/ton-proof
- TON Connect UI API and pinned CDN usage: https://github.com/ton-connect/sdk/blob/main/packages/ui/README.md

## Phase 2 security rules

- `ton_proof` must use a server-issued, single-use payload. The backend reconstructs `ton-proof-item-v2/`, binds the signature to the exact app domain, timestamp, network and wallet address, and consumes the payload atomically after successful verification.
- `walletStateInit` is authoritative for deriving the address and resolving the public key. The client-reported public key is not trusted by itself.
- `sendTransaction` requests must set `network: "-239"` for TON Mainnet and a short `validUntil`; a wallet confirmation is not treated as a finalized payment until the receiving transaction is found and verified on-chain.
- Automatic Swap must remain fail-closed: create an intent, send a unique reference/comment to the project wallet, monitor the final receiving transaction, then credit exactly once inside a MongoDB transaction with a unique transaction hash/source ID.

Official references used for Phase 2:

- https://docs.ton.org/applications/ton-connect/how-to/ton-proof
- https://docs.ton.org/applications/ton-connect/how-to/connect
- https://docs.ton.org/applications/ton-connect/how-to/send-transaction
- https://docs.ton.org/applications/payments/overview
- https://docs.ton.org/applications/ton-connect/api-reference/sdk
