# WhatsApp bot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys). It answers messages from the numbers listed in `ALLOWED` in `index.js`.

## Run it

```bash
cd apps/whatsapp-bot
npm install
npm start          # or, from the repo root: npm run bot
```

On the first run, a QR code appears in the terminal. Scan it from WhatsApp (Linked devices) to log in.

## Login files stay local

The login is saved in `auth/` (and `auth_backup/`). These folders hold the WhatsApp session credentials, so they are **git-ignored and must never be committed**: anyone with them can act as the linked number. Each person who runs the bot scans the QR once on their own machine.

If the session ends ("Sesión cerrada"), delete `auth/` and scan again.
