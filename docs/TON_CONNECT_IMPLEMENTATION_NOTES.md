# GramUp Wallet Integration Notes

## Phase 1 scope

Phase 1 adds the TON Connect manifest and client connection flow. The connected account address is synchronized with the authenticated GramUp user and the withdrawal UI uses that address instead of asking the user to type an address. Existing manual withdrawal API compatibility is retained for a controlled rollout; when a connected wallet exists, the server rejects a different address.

No external payment is sent in Phase 1. Deposit-to-Swap automation remains disabled until the transaction intent, TON proof, chain confirmation, and idempotent crediting flow are implemented and tested.

## Official references

- TON Connect setup and vanilla JavaScript API: https://docs.ton.org/applications/ton-connect/get-started
- TON Connect core concepts and manifest requirements: https://docs.ton.org/applications/ton-connect/core-concepts
- TON proof verification requirements: https://docs.ton.org/applications/ton-connect/how-to/ton-proof
- TON Connect UI API and pinned CDN usage: https://github.com/ton-connect/sdk/blob/main/packages/ui/README.md
