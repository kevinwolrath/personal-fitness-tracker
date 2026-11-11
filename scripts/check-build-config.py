"""Check that a built Android package carries this build's sync configuration (#136, #146), without printing secrets.

Usage: AAB=<path to .aab or .apk> EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY=<key> EXPO_PUBLIC_BODY_ANVIL_API_URL=<url> \
       python3 check-build-config.py
Exit 0 when the JS bundle (base/assets/index.android.bundle in an AAB, assets/index.android.bundle in an APK) contains
both the enrollment key and the API base URL; exit 1 otherwise. Hermes keeps string literals readable in its string
table (ASCII as bytes, other text as UTF-16), so both encodings are checked. The key is never printed; the URL is not
a secret.
"""
import os
import sys
import zipfile

path = os.environ.get("AAB", "")
key = os.environ.get("EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY", "").strip()
url = os.environ.get("EXPO_PUBLIC_BODY_ANVIL_API_URL", "").strip().rstrip("/")
if not key:
    sys.exit("Build config check: EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY is not set")
if not url:
    sys.exit("Build config check: EXPO_PUBLIC_BODY_ANVIL_API_URL is not set")
if not os.path.isfile(path):
    sys.exit("Build config check: package not found")

with zipfile.ZipFile(path) as z:
    names = [n for n in z.namelist() if n.endswith("assets/index.android.bundle")]
    if not names:
        sys.exit("Build config check: no JS bundle in the package")
    bundle = z.read(names[0])


def contains(text: str) -> bool:
    return text.encode("utf-8") in bundle or text.encode("utf-16-le") in bundle


problems = []
if not contains(key):
    problems.append("the configured enrollment key")
if not contains(url):
    problems.append(f"the API URL {url}")
if problems:
    sys.exit("Build config check: the JS bundle does NOT contain " + " or ".join(problems) + "; refusing to ship")
print(f"Build config check: enrollment key present (value not shown); API URL {url} present")
