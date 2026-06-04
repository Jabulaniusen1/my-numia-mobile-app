# NUMIA Mobile App (MVP)

React Native + Expo mobile app for the NUMIA identity-first wallet experience.

## Included MVP flows

- Splash + onboarding
- Wallet create/import (seed phrase or private key)
- Claim NUMIA identity (`username@numia`)
- Wallet sign-in with backend challenge/response
- Dashboard + identity card
- Send flow with backend quote, identity resolution (`alex@numia` -> wallet address), on-chain SOL broadcast, transfer history sync, and service-fee settlement when configured
- Receive flow with QR + copy
- Profile + basic editable profile fields

## Design direction implemented

- Hugeicons iconography
- DiceBear avatars (`Dylan` style)
- Satoshi font
- Dark futuristic visual system with neon blue + violet glow

## Environment

Create `.env.local` from `.env.example` and set backend URL:

```bash
cp .env.example .env.local
```

Example value:

```env
EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
EXPO_PUBLIC_API_TIMEOUT_MS=12000
```

For physical devices, use your machine LAN IP instead of `localhost`.

## Run

```bash
npm install
npm run start
```

Then open on iOS/Android via Expo Go.

## Notes

- This MVP focuses on identity + UX flow validation.
- Send flow quotes the backend (`/api/transactions/quote`), broadcasts SOL on-chain, records the transfer with `/api/transactions/send`, and loads activity from backend history (`/api/transactions/history`).
- If NUMIA service fees are enabled by backend config, the app sends the service-fee payment and verifies it through `/api/transactions/:id/service-fee/payment`.
- Local wallet custody is for MVP/prototyping only.
