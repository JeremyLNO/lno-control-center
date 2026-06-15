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

## Wire it up (Vercel)

Set a single env var on the project (Production), then redeploy:

```
VITE_GOOGLE_CLIENT_ID = <your-client-id>.apps.googleusercontent.com
```

- The `VITE_` prefix exposes it to the browser bundle **and** is readable by the serverless
  functions (which verify the ID token's signature/audience). One variable feeds both.
- After setting it, **redeploy** so the value is baked into the client build. The
  "Sign in with Google" button appears automatically once it's present; until then the
  login page falls back to username/password.

Optional: `ALLOWED_EMAIL_DOMAIN` (defaults to `lno.company`) to change the allowed domain.

## How verification works

The browser gets a Google **ID token** (a JWT) and posts it to `POST /api/auth {action:'google'}`.
The server verifies the token **locally** against Google's public keys (`api/_lib/google.js`,
JWKS + `jsonwebtoken`) — signature, `aud` (our client ID), `iss`, `exp` — then enforces
`email_verified`, the email domain, and the `hd` (hosted-domain) claim before issuing the
app's own JWT. Nothing is trusted from the client.
