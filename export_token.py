"""
export_token.py — einmalig lokal ausführen
Loggt ein und gibt den Token-Inhalt direkt aus.
"""
import getpass, json, os
from pathlib import Path
from garminconnect import Garmin

email    = os.environ.get("GARMIN_EMAIL") or input("E-Mail: ").strip()
password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Passwort: ")

def mfa():
    return input("MFA-Code: ").strip()

TOKEN_DIR = Path.home() / ".garminconnect"
TOKEN_DIR.mkdir(mode=0o700, exist_ok=True)

api = Garmin(email=email, password=password, prompt_mfa=mfa)
api.login(str(TOKEN_DIR))

# Token-File lesen falls es gespeichert wurde
token_file = TOKEN_DIR / "garmin_tokens.json"
if token_file.exists():
    content = token_file.read_text()
    print("\n" + "="*60)
    print("Secret-Name:  GARMIN_TOKENS")
    print("Secret-Value:")
    print("-"*60)
    print(content)
    print("="*60)
else:
    # Direkt aus dem API-Objekt auslesen
    print("\nToken-Datei nicht gefunden — lese direkt aus API-Objekt...")
    token_data = {}
    for attr in vars(api):
        val = getattr(api, attr, None)
        if val and "token" in attr.lower():
            try:
                token_data[attr] = vars(val) if hasattr(val, "__dict__") else str(val)
            except Exception:
                pass

    # Auch in api.session schauen
    try:
        if hasattr(api, "session"):
            cookies = dict(api.session.cookies)
            if cookies:
                token_data["session_cookies"] = cookies
    except Exception:
        pass

    content = json.dumps(token_data, indent=2, default=str)
    print("\n" + "="*60)
    print("Secret-Name:  GARMIN_TOKENS")
    print("Secret-Value:")
    print("-"*60)
    print(content)
    print("="*60)
    # Auch speichern damit GitHub Actions es laden kann
    token_file.write_text(content)
    token_file.chmod(0o600)
    print(f"\nGespeichert: {token_file}")
