"""Check that a built Android package carries the health-sync enrollment key (#136), without printing it.

Usage: AAB=<path to .aab or .apk> EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY=<key> python3 check-enrollment-key.py
Exit 0 when the JS bundle (base/assets/index.android.bundle in an AAB, assets/index.android.bundle in an APK)
contains the key; exit 1 otherwise. Hermes keeps string literals readable in its string table (ASCII as bytes,
other text as UTF-16), so both encodings are checked.
"""
import os
import sys
import zipfile

path = os.environ.get("AAB", "")
key = os.environ.get("EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY", "").strip()
if not key:
    sys.exit("Enrollment key check: EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY is not set")
if not os.path.isfile(path):
    sys.exit("Enrollment key check: package not found")

with zipfile.ZipFile(path) as z:
    names = [n for n in z.namelist() if n.endswith("assets/index.android.bundle")]
    if not names:
        sys.exit("Enrollment key check: no JS bundle in the package")
    bundle = z.read(names[0])

if key.encode("utf-8") in bundle or key.encode("utf-16-le") in bundle:
    print("Enrollment key check: present in the JS bundle (value not shown)")
    sys.exit(0)
sys.exit("Enrollment key check: the JS bundle does NOT contain the configured enrollment key; refusing to ship")
