# Sign in with Google (restricted to @lno.company)

The Control Center supports "Sign in with Google", restricted to the **@lno.company**
Google Workspace domain. On first sign-in an account is auto-created (role: *viewer*,
username = the part before `@`); first/last name are saved from Google on every sign-in.
Password sign-in remains available as a break-glass fallback (e.g. the seeded `admin`).

## One-time setup (Google Cloud Console)

1. **OAuth consent screen** → set **User type = Internal**. This alone restricts sign-in
   to your Workspace domain (Google won't issue tokens to outside accounts).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins**: `https://cc.lno.company`
     (add `http://localhost:5173` and `http://localhost:8788` if you want it in local dev).
   - You do **not** need an authorized redirect URI — Google Identity Services returns the
     ID token directly to the page.
3. Copy the generated **Client ID** (looks like `xxxxx.apps.googleusercontent.com`).

## Wire it up

The current LNO client ID is **baked in as the default** (`src/main.jsx` `GOOGLE_CLIENT_ID`
and `api/_lib/google.js`) — a client ID is public, not a secret, so committing it is fine.
The "Sign in with Google" button therefore works out of the box once deployed; the only
hard requirement is that the OAuth client's **authorized JavaScript origin** includes
`https://cc.lno.company`.

To use a *different* client ID without editing code, set a Vercel env var (Production)
and redeploy — it overrides the baked-in default for both the client and the functions:

```
VITE_GOOGLE_CLIENT_ID = <your-client-id>.apps.googleusercontent.com
```

Optional: `ALLOWED_EMAIL_DOMAIN` (defaults to `lno.company`) to change the allowed domain.

## How verification works

The browser gets a Google **ID token** (a JWT) and posts it to `POST /api/auth {action:'google'}`.
The server verifies the token **locally** against Google's public keys (`api/_lib/google.js`,
JWKS + `jsonwebtoken`) — signature, `aud` (our client ID), `iss`, `exp` — then enforces
`email_verified`, the email domain, and the `hd` (hosted-domain) claim before issuing the
app's own JWT. Nothing is trusted from the client.
