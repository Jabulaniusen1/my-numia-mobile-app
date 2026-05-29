# NUMIA Mobile App (MVP)

React Native + Expo mobile app for the NUMIA identity-first wallet experience.

## Included MVP flows

- Splash + onboarding
- Wallet create/import (seed phrase or private key)
- Claim NUMIA identity (`username@numia`)
- Wallet sign-in with backend challenge/response
- Dashboard + identity card
- Send flow with identity resolution (`alex@numia` -> wallet address)
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
- Send flow writes transfer intents to backend (`/api/transactions/send-intent`) and loads activity from backend history (`/api/transactions/history`).
- On-chain transaction broadcast is not implemented yet; intents are currently stored as simulated transfers.
- Local wallet custody is for MVP/prototyping only.
