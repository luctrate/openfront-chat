# Publishing to Chrome Web Store and Firefox Add-ons

Step-by-step for shipping this extension as a beta / unlisted release. Companion docs: [PRIVACY.md](./PRIVACY.md), [STORE-LISTING.md](./STORE-LISTING.md).

## 0. Prep checklist (do once before either store)

- [ ] Bump `version` in **all four** manifests when re-uploading. Stores reject re-uploads of the same version. Semver like `0.2.0` → `0.2.1` → `0.3.0-beta.1` etc. Note Chrome only accepts dotted digits (no dashes): use `0.2.0.1` for beta rev.
- [ ] Publish [PRIVACY.md](./PRIVACY.md) at a stable **https://** URL — both stores require this. E.g. `https://asp.now/openfront-team-chat/privacy`.
- [ ] Take 1–5 screenshots at **1280×800** or **640×400** per [STORE-LISTING.md](./STORE-LISTING.md).
- [ ] Prepare store copy from [STORE-LISTING.md](./STORE-LISTING.md) (title, summary, description, permissions justifications).
- [ ] Deploy the relay so `wss://relay.asp.now` is live and healthy (see [deploy/k8s/](./deploy/k8s/)).

## 1. Build the submission zips

```bash
./scripts/build-store.sh          # writes dist/openfront-team-chat-chrome-<v>.zip and dist/…-firefox-<v>.zip
./scripts/build-store.sh chrome   # just Chrome
./scripts/build-store.sh firefox  # just Firefox
```

The script sets the active `manifest.json`/`config.js` to the right prod variant before zipping. It excludes dev manifests, scripts, docs, and the relay-example.

Verify what's inside:
```bash
unzip -l dist/openfront-team-chat-chrome-0.2.0.zip
```

Expected files:
```
manifest.json      background.js      content.js         content.css
config.js          popup.html         popup.js
icons/16.png       icons/32.png       icons/48.png       icons/128.png
```
Nothing else. If you see `manifest.chrome.json`, `use.sh`, or `deploy/`, add them to `EXCLUDE` in the build script.

## 2. Chrome Web Store

### One-time developer account
1. Go to https://chrome.google.com/webstore/devconsole
2. Pay the **$5 one-time** registration fee.
3. Verify email + phone.
4. Answer the **EU trader** question — for a free hobby extension, choose *"Es handelt sich nicht um ein Händlerkonto"* (Non-trader).

### Per-submission
1. **New item** → upload `dist/openfront-team-chat-chrome-<v>.zip`.
2. **Store listing** tab:
   - Category: **Communication**
   - Language: primary language of your listing (English is fine)
   - Detailed description: paste from [STORE-LISTING.md](./STORE-LISTING.md)
   - Screenshots: upload 1–5
   - Small promo tile 440×280 (optional, skip for beta)
3. **Privacy practices** tab:
   - Single purpose: *"Chat overlay for openfront.io games"*
   - Permissions justifications: paste the table from [STORE-LISTING.md](./STORE-LISTING.md)
   - Data usage: check "Personally identifiable information" (nickname), "Website content" (game state), "User activity" (chat messages). Certify you do not sell, transfer, or use them outside their stated purpose.
   - Privacy policy URL: your hosted PRIVACY.md
4. **Distribution** tab:
   - Visibility: **Unlisted** for beta (only accessible via direct URL). Switch to Public later.
   - Countries: all, or restrict to EEA/DE if you prefer during beta.
5. Submit for review.

Review usually takes 1–3 business days for a first submission; updates are faster (often < 24h).

Once approved:
- Your extension ID is fixed. Copy it (format `abcdefghijklmnop...`).
- Add it to the relay's `ALLOWED_ORIGINS`. With `.env` populated (`GCP_PROJECT` / `GCP_INSTANCE` / `GCP_ZONE`):
  ```bash
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  gcloud compute ssh --tunnel-through-iap \
    --project="$GCP_PROJECT" --zone="$GCP_ZONE" "$GCP_INSTANCE" \
    --command='sudo k3s kubectl -n openfront-team-chat set env deployment/relay \
      ALLOWED_ORIGINS="chrome-extension://<YOUR-CHROME-ID>,moz-extension://"'
  ```

## 3. Firefox Add-ons (AMO)

### One-time developer account
1. Sign in at https://addons.mozilla.org/developers/
2. Free, no fees.

### Per-submission (Option A — Listed, public)
1. **Submit a New Add-on** → upload `dist/openfront-team-chat-firefox-<v>.zip`.
2. Distribution: **"On this site"** (listed).
3. Fill listing (same copy as Chrome).
4. Choose review category, license (MIT or similar for OSS).
5. Submit. Auto-review normally passes in minutes; manual review triggered by broad permissions or code patterns takes days.

### Per-submission (Option B — Unlisted, self-distribute)  ← preferred for beta
1. Same submit flow → distribution: **"On your own"**.
2. Mozilla signs the XPI, you host it and share the URL with testers.
3. Installation: users drag-drop the signed XPI into Firefox, or click a link with `<a href="…xpi">`.
4. Auto-updates only if you set `applications.gecko.update_url` in the manifest and host an update manifest JSON. Skip for beta.

### Firefox extension origin note
Firefox uses a **per-install UUID** for `moz-extension://<uuid>/` — you cannot pre-list an exact origin. In the relay's `ALLOWED_ORIGINS`, the value `moz-extension://` acts as a prefix match, accepting any Firefox install. The `SHARED_SECRET` in the config bundle is what actually gates access.

## 4. After first approval

- **Chrome**: users get the update within ~5h of a new version upload.
- **Firefox listed**: same, within a few hours.
- **Firefox unlisted**: you distribute the new XPI manually or via an update manifest.

Rotate the `SHARED_SECRET` when you bump versions if you want stronger key hygiene — see [README.md](./README.md) for the rotate command.

## 5. Version bump workflow

```bash
# Edit all four manifests to the same new version.
NEW=0.2.1
for f in manifest.chrome.json manifest.firefox.json manifest.dev-chrome.json manifest.dev-firefox.json; do
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW\"/" "$f"
done

# Build + upload.
./scripts/build-store.sh
```

For beta iteration Chrome doesn't allow `-beta.N` in the version string — use a fourth digit: `0.2.1.1`, `0.2.1.2`, then `0.2.1` for the stable release.

## 6. Common submission gotchas

| Problem | Fix |
|---|---|
| Chrome: *"Item name is not unique"* | Change `name` in `manifest.chrome.json`. |
| Chrome: *"Broad host permissions"* warning | `wss://relay.asp.now/*` is scoped; `openfront.io` is a single site. Should not trigger. |
| Firefox: *"background.service_worker is currently disabled. Add background.scripts."* | You uploaded the Chrome zip in Firefox. Rebuild with `./scripts/build-store.sh firefox`. |
| Firefox: manifest rejected on prod but works locally | Confirm gecko `id` is a real email-like address, not `@example.com`. |
| Chrome: *"Version has been used"* | Bump the version in the manifest before re-uploading. |
| Both: *"Missing privacy policy URL"* | Publish PRIVACY.md at an https:// URL and paste that URL into the submission form. |

## 7. Beta channel strategy

- Chrome: use **Unlisted** visibility → shareable install URL, invisible to search.
- Firefox: use **Unlisted** distribution → signed XPI you host yourself.
- Both are appropriate for internal / friends-only testing.
- Move to **Public** / **Listed** when you're ready for wider release.
