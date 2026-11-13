#!/bin/bash
# Points the stable GitHub Pages address (gh-pages branch of this repo) at the current tunnel URL.
# The page forwards the visitor's query string (e.g. ?invite=CODE), so the invite code is never stored
# in the public repository — it only lives in the link you share.
set -eu
URL="$1"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE="${VIBII_PAGES_REMOTE:-$(grep -E '^VIBII_PAGES_REMOTE=' "$DIR/.env.local" 2>/dev/null | cut -d= -f2-)}"
REMOTE="${REMOTE:-$(git -C "$DIR" remote get-url origin)}"
PAGES="$DIR/.data/live/pages"
if [ ! -d "$PAGES/.git" ]; then
  rm -rf "$PAGES"
  git clone --quiet --branch gh-pages --single-branch "$REMOTE" "$PAGES" 2>/dev/null || {
    mkdir -p "$PAGES" && git -C "$PAGES" init -q -b gh-pages && git -C "$PAGES" remote add origin "$REMOTE"
  }
fi
git -C "$PAGES" pull -q --rebase origin gh-pages 2>/dev/null || true
cat > "$PAGES/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vibii</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #120d22; color: #f3ecff;
         font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; text-align: center; padding: 16px; }
  a { color: #f7a873; }
</style>
<script>
  var target = "${URL}/login" + (location.search || "");
  location.replace(target);
</script>
</head>
<body>
  <main>
    <h1 style="font-weight:500;font-size:48px;margin:0">Vibii</h1>
    <p>Opening your soundtrack… <a id="go" href="${URL}/login">Tap here if nothing happens</a>.</p>
    <script>document.getElementById("go").href = target;</script>
  </main>
</body>
</html>
HTML
touch "$PAGES/.nojekyll"
git -C "$PAGES" add -A
if git -C "$PAGES" diff --cached --quiet; then
  echo "$(date '+%F %T') link page already points to $URL"
  exit 0
fi
git -C "$PAGES" -c user.name="Vibii link bot" -c user.email="vibii-link-bot@users.noreply.github.com" commit -q -m "Point Vibii link to current server"
git -C "$PAGES" push -q origin gh-pages
echo "$(date '+%F %T') link page now points to $URL"
