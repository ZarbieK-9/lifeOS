# LifeOS — Home, Privacy & Terms (for Google OAuth)

These pages are used for **Google Cloud OAuth consent screen**. The homepage (index.html) is written to meet Google’s requirements: it identifies the app, describes functionality, explains why we request user data, and links to the Privacy Policy. All pages are visible without login.

## Important: “Verified domain you own”

Google requires the app homepage to be **hosted on a verified domain you own**. They do **not** accept third‑party platforms where you cannot verify subdomain ownership, including:

- **GitHub Pages (username.github.io)** — Google typically does not consider this a domain you “own” for verification.
- Google Sites, Facebook, Instagram, Twitter, etc.

**Options:**

1. **Use a domain you own** (e.g. `lifeos.app`, `yourapp.com`, or a subdomain like `app.yourdomain.com`). Host these same files there, then:
   - Add the domain in **Google Search Console** and verify ownership (e.g. DNS TXT record or HTML file).
   - Use that domain’s URLs on the OAuth consent screen (home page, privacy, terms).
2. **Keep the app in Testing mode** — Do not submit for “Production” verification. You can add up to 100 test users (by email) and use the app without a verified homepage. Homepage/privacy/terms can still point to GitHub Pages for test users; full verification is only required when you publish to all users.

---

- **Application home page** → your base URL (e.g. `https://your-domain.com/` or `https://your-domain.com/index.html`)
- **Privacy policy link** → `https://your-domain.com/privacy.html`
- **Terms of Service link** → `https://your-domain.com/terms.html`

## Hosting (pick one)

### Option A: GitHub Pages (free)

1. Create a repo (e.g. `lifeos-web` or use a `docs/` folder in your main repo).
2. Copy the contents of this `web/` folder into the repo root (or into `docs/` and enable GitHub Pages from that folder).
3. Enable GitHub Pages in repo **Settings → Pages** (source: main branch, folder: root or `/docs`).
4. Your URLs will be like:
   - `https://YOUR_USERNAME.github.io/lifeos-web/`
   - `https://YOUR_USERNAME.github.io/lifeos-web/privacy.html`
   - `https://YOUR_USERNAME.github.io/lifeos-web/terms.html`

### Option B: Netlify / Vercel (free)

1. Sign up at [netlify.com](https://netlify.com) or [vercel.com](https://vercel.com).
2. Create a new site and point it at a repo that contains this `web/` folder (or drag-and-drop the `web/` folder).
3. Use the default domain they give you (e.g. `https://lifeos.netlify.app`).

### Option C: Your own backend/domain

If you already serve a site at e.g. `https://api.yourdomain.com`, add routes or static files so that:

- `GET /` or `GET /index.html` → home
- `GET /privacy.html` → privacy policy
- `GET /terms.html` → terms of service

## What to put in Google Cloud Console

1. Go to **APIs & Services → OAuth consent screen**.
2. Under **App domain** (or **Application home page**, **Privacy policy**, **Terms of Service**):
   - **Application home page:** `https://YOUR_DOMAIN/` (or `.../index.html`)
   - **Application privacy policy link:** `https://YOUR_DOMAIN/privacy.html`
   - **Application Terms of Service link:** `https://YOUR_DOMAIN/terms.html`
3. Save.

Use the **exact** URLs where you host these files (replace `YOUR_DOMAIN` with your real base URL, no trailing slash for the home page if you use `/`).
