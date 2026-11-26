# TON USDT migration research

- Official TON Jettons payments guide: https://docs.ton.org/applications/payments/jettons
- Official TON API v3 overview: https://docs.ton.org/api/v3/overview
- TON Center v3 Swagger: https://toncenter.com/api/v3/index.html
- Canonical USDT-on-TON Jetton master from TON Docs: `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`.
- TON Docs states USDT on TON is a Jetton. Jetton transfers must be checked against an allowlisted master; fake Jetton wallets are possible.
- TON Docs recommends deriving the project deposit wallet's USDT Jetton wallet from the master via `get_wallet_address(owner)` and checking the incoming transaction source against that wallet.
- For invoice deposits, match the forward payload/reference to the database invoice and credit only after exact validation.
- TON Docs specifies transfer_notification opcode `0x7362d09c`, exact base-unit amount parsing, expected sender validation, and bounce/outgoing-message checks.
- TON API v3 exposes `GET https://toncenter.com/api/v3/jetton/transfers`, plus jetton masters/wallets endpoints. It is the indexed data layer for decoded Jetton data.
- TON API v3 mainnet base URL is `https://toncenter.com/api/v3`.
