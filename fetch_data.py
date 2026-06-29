"""
fetch_data.py — Garmin Connect Datenabruf
=========================================
Ruft alle relevanten Gesundheitsdaten von Garmin Connect ab
und speichert sie als docs/data/garmin.json.

Verwendung (lokal):
    pip install "garminconnect>=0.2.13"
    python fetch_data.py

Credentials werden aus Umgebungsvariablen gelesen:
    GARMIN_EMAIL, GARMIN_PASSWORD

Falls nicht gesetzt → interaktive Eingabe (für lokale Tests).

HINWEIS MFA: Garmin verlangt manchmal einen 2FA-Code.
    Beim ersten lokalen Lauf kann ein MFA-Prompt erscheinen.
    In GitHub Actions wird der gespeicherte Session-Token
    (garmin_session/) wiederverwendet → kein MFA nötig.
"""

import json
import os
import sys
import time
import logging
import getpass
from datetime import date, timedelta, datetime
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Pfade ───────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
OUT_PATH = ROOT / "docs" / "data" / "garmin.json"
SESSION_DIR = ROOT / "garmin_session"   # Session-Token-Cache (lokal)


# ── Hilfsfunktionen ─────────────────────────────────────────────────────────
def get_credentials():
    email = os.environ.get("GARMIN_EMAIL", "").strip()
    password = os.environ.get("GARMIN_PASSWORD", "").strip()
    if not email:
        print("\nGARMIN_EMAIL nicht gefunden.")
        email = input("Garmin E-Mail: ").strip()
    if not password:
        password = getpass.getpass("Garmin Passwort: ")
    return email, password


def get_mfa():
    """Callback für MFA/2FA – wird nur aufgerufen wenn Garmin es verlangt."""
    return input("Garmin MFA-Code (aus Authenticator-App): ").strip()


def safe_call(fn, label="", default=None, retries=2):
    """Führt fn() aus, wiederholt bei Fehler und gibt default zurück."""
    for attempt in range(retries + 1):
        try:
            result = fn()
            return result
        except Exception as exc:
            if attempt < retries:
                log.warning(f"{label} — Versuch {attempt + 1} fehlgeschlagen: {exc!r}. Retry in 3s...")
                time.sleep(3)
            else:
                log.error(f"{label} — endgültig fehlgeschlagen: {exc!r}")
                return default


def fmt_duration(seconds):
    if seconds is None:
        return None
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


# ── Garmin-Login ────────────────────────────────────────────────────────────
def login(email, password):
    try:
        from garminconnect import (
            Garmin,
            GarminConnectAuthenticationError,
            GarminConnectConnectionError,
            GarminConnectTooManyRequestsError,
        )
    except ImportError:
        log.error("garminconnect nicht installiert. Bitte: pip install 'garminconnect>=0.2.13'")
        sys.exit(1)

    log.info("Verbinde mit Garmin Connect...")
    api = Garmin(email=email, password=password, prompt_mfa=get_mfa)

    # Session-Token wiederverwenden falls vorhanden (vermeidet MFA in CI)
    try:
        api.login(str(SESSION_DIR))
        log.info("Session-Token geladen — kein neuer Login nötig.")
    except Exception:
        log.info("Kein gültiger Session-Token — normaler Login...")
        try:
            api.login()
        except GarminConnectAuthenticationError as exc:
            log.error(f"Authentifizierung fehlgeschlagen: {exc}")
            sys.exit(1)
        except GarminConnectConnectionError as exc:
            log.error(f"Verbindungsfehler: {exc}")
            sys.exit(1)

        # Token für zukünftige Läufe speichern
        try:
            SESSION_DIR.mkdir(exist_ok=True)
            api.garth.dump(str(SESSION_DIR))
            log.info(f"Session-Token gespeichert: {SESSION_DIR}/")
        except Exception as exc:
            log.warning(f"Session speichern fehlgeschlagen: {exc!r}")

    return api


# ── Datenabruf ──────────────────────────────────────────────────────────────
def fetch_hrv(api, today_str, yesterday_str):
    raw = safe_call(lambda: api.get_hrv_data(today_str), "HRV (heute)")
    if raw is None:
        raw = safe_call(lambda: api.get_hrv_data(yesterday_str), "HRV (gestern)")

    result = {
        "lastNight": None,
        "status": "UNKNOWN",
        "weeklyAvg": None,
        "balancedLow": None,
        "balancedHigh": None,
    }
    if not raw:
        return result
    try:
        summary = raw.get("hrvSummary", {})
        nightly = raw.get("lastNight", {})
        result["lastNight"] = nightly.get("lastNight") or nightly.get("value")
        result["status"] = summary.get("status", "UNKNOWN")
        result["weeklyAvg"] = summary.get("weeklyAvg")
        result["balancedLow"] = summary.get("balancedLow")
        result["balancedHigh"] = summary.get("balancedHigh")
    except Exception as exc:
        log.warning(f"HRV Parsing-Fehler: {exc!r}")
    return result


def fetch_body_battery(api, today):
    history = []
    for i in range(7):
        day = (today - timedelta(days=i)).isoformat()
        raw = safe_call(
            lambda d=day: api.get_body_battery(d, d),
            f"Body Battery {day}",
        )
        if raw and isinstance(raw, list) and raw:
            entry = raw[0]
            history.append({
                "date": day,
                "charged": entry.get("charged"),
                "drained": entry.get("drained"),
                "endValue": entry.get("endValue"),
            })

    current = history[0].get("endValue") if history else None
    return {"current": current, "history": history}


def fetch_rhr(api, today_str, yesterday_str):
    raw = safe_call(lambda: api.get_rhr_day(today_str), "RHR (heute)")
    if raw is None:
        raw = safe_call(lambda: api.get_rhr_day(yesterday_str), "RHR (gestern)")
    if not raw:
        return None
    # Verschiedene API-Antwortformate abdecken
    try:
        metrics = raw.get("allMetrics", {}).get("metricsMap", {})
        rhr_list = metrics.get("WELLNESS_RESTING_HEART_RATE", [])
        if rhr_list:
            return rhr_list[0].get("value")
    except Exception:
        pass
    return raw.get("restingHeartRate") or raw.get("value")


def fetch_sleep(api, today_str, yesterday_str):
    raw = safe_call(lambda: api.get_sleep_data(today_str), "Schlaf (heute)")
    if raw is None:
        raw = safe_call(lambda: api.get_sleep_data(yesterday_str), "Schlaf (gestern)")

    result = {
        "score": None,
        "totalSeconds": None,
        "deepSeconds": None,
        "lightSeconds": None,
        "remSeconds": None,
        "awakeSeconds": None,
    }
    if not raw:
        return result
    try:
        dto = raw.get("dailySleepDTO", {})
        scores = dto.get("sleepScores", {}).get("overall", {})
        result["score"] = scores.get("value") or dto.get("sleepScore")
        result["totalSeconds"] = dto.get("sleepTimeSeconds")
        result["deepSeconds"] = dto.get("deepSleepSeconds")
        result["lightSeconds"] = dto.get("lightSleepSeconds")
        result["remSeconds"] = dto.get("remSleepSeconds")
        result["awakeSeconds"] = dto.get("awakeSleepSeconds")
    except Exception as exc:
        log.warning(f"Schlaf Parsing-Fehler: {exc!r}")
    return result


def fetch_stress(api, today_str):
    raw = safe_call(lambda: api.get_stress_data(today_str), "Stress")
    if not raw:
        return {"avgStressLevel": None, "maxStressLevel": None}
    return {
        "avgStressLevel": raw.get("avgStressLevel"),
        "maxStressLevel": raw.get("maxStressLevel"),
    }


def fetch_vo2max(api, today_str):
    raw = safe_call(lambda: api.get_stats(today_str), "VO2max / Stats")
    if not raw:
        return None
    return raw.get("vo2Max") or raw.get("maxMetValue")


def fetch_last_activity(api):
    raw = safe_call(lambda: api.get_activities(0, 1), "Letzte Aktivität")
    if not raw or not isinstance(raw, list) or not raw:
        return None
    act = raw[0]
    return {
        "name": act.get("activityName"),
        "type": act.get("activityType", {}).get("typeKey"),
        "distanceMeters": act.get("distance"),
        "durationSeconds": act.get("duration"),
        "avgHr": act.get("averageHR"),
        "maxHr": act.get("maxHR"),
        "calories": act.get("calories"),
        "startTime": act.get("startTimeLocal"),
    }


# ── Hauptprogramm ───────────────────────────────────────────────────────────
def main():
    email, password = get_credentials()
    api = login(email, password)

    today = date.today()
    today_str = today.isoformat()
    yesterday_str = (today - timedelta(days=1)).isoformat()

    log.info("── Starte Datenabruf ──────────────────────────────────────────")

    log.info("HRV...")
    hrv = fetch_hrv(api, today_str, yesterday_str)

    log.info("Body Battery (7 Tage)...")
    body_battery = fetch_body_battery(api, today)

    log.info("Ruhepuls...")
    rhr = fetch_rhr(api, today_str, yesterday_str)

    log.info("Schlaf...")
    sleep = fetch_sleep(api, today_str, yesterday_str)

    log.info("Stress...")
    stress = fetch_stress(api, today_str)

    log.info("VO2max...")
    vo2max = fetch_vo2max(api, today_str)

    log.info("Letzte Aktivität...")
    last_activity = fetch_last_activity(api)

    log.info("── Datenabruf abgeschlossen ───────────────────────────────────")

    data = {
        "updated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hrv": hrv,
        "bodyBattery": body_battery,
        "restingHeartRate": rhr,
        "sleep": sleep,
        "stress": stress,
        "vo2max": vo2max,
        "lastActivity": last_activity,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    log.info(f"✓ Daten gespeichert → {OUT_PATH}")
    print(json.dumps(data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
