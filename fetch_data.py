"""
fetch_data.py — Garmin Connect Datenabruf (30-Tage-History)
=============================================================
Ruft alle relevanten Gesundheitsdaten von Garmin Connect ab
und speichert sie als docs/data/garmin.json.

── Erster lokaler Lauf (einmalig) ──────────────────────────────
    pip install "garminconnect>=0.2.13"
    python3 fetch_data.py
    → MFA-Code eingeben wenn Garmin ihn verlangt
    → Am Ende wird GARMIN_TOKENS ausgegeben → als GitHub Secret speichern

── GitHub Actions (danach automatisch) ─────────────────────────
    Secrets nötig:
        GARMIN_TOKENS   ← Token-String vom ersten lokalen Lauf
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
ROOT     = Path(__file__).parent
OUT_PATH = ROOT / "docs" / "data" / "garmin.json"
TOKEN_DIR = Path.home() / ".garminconnect"


# ── Hilfsfunktionen ─────────────────────────────────────────────────────────
def get_credentials():
    email    = os.environ.get("GARMIN_EMAIL", "").strip()
    password = os.environ.get("GARMIN_PASSWORD", "").strip()
    if not email:
        print("\nGARMIN_EMAIL nicht gefunden.")
        email = input("Garmin E-Mail: ").strip()
    if not password:
        password = getpass.getpass("Garmin Passwort: ")
    return email, password


def get_mfa():
    return input("Garmin MFA-Code (aus E-Mail/Authenticator): ").strip()


def safe(fn, label="", default=None):
    """Führt fn() aus und gibt default zurück bei jedem Fehler."""
    try:
        return fn()
    except Exception as exc:
        log.warning(f"{label or 'API'}: {exc!r}")
        return default


# ── Garmin-Login ────────────────────────────────────────────────────────────
def login():
    try:
        from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectConnectionError
    except ImportError:
        log.error("garminconnect nicht installiert: pip3 install 'garminconnect>=0.3.0'")
        sys.exit(1)

    # Weg 1: Token aus CI-Secret
    token_str = os.environ.get("GARMIN_TOKENS", "").strip()
    if token_str:
        log.info("GARMIN_TOKENS gefunden — schreibe Token-Datei...")
        TOKEN_DIR.mkdir(mode=0o700, exist_ok=True)
        tf = TOKEN_DIR / "garmin_tokens.json"
        tf.write_text(token_str)
        tf.chmod(0o600)
        try:
            api = Garmin(email="", password="", prompt_mfa=get_mfa)
            api.login(str(TOKEN_DIR))
            log.info("✓ Login via CI-Token")
            return api
        except GarminConnectAuthenticationError as e:
            log.error("🔴 TOKEN ABGELAUFEN: Garmin-Token ist ungültig oder abgelaufen!")
            log.error("   → Token erneuern: python3 fetch_data.py lokal ausführen und GARMIN_TOKENS Secret aktualisieren")
            log.error(f"   Details: {e}")
            sys.exit(1)

    # Weg 2: Lokaler Token-Cache
    if (TOKEN_DIR / "garmin_tokens.json").exists():
        log.info("Lokaler Token gefunden...")
        email, pw = get_credentials()
        try:
            api = Garmin(email=email, password=pw, prompt_mfa=get_mfa)
            api.login(str(TOKEN_DIR))
            log.info("✓ Login via lokalem Token")
            return api
        except GarminConnectAuthenticationError as e:
            log.warning(f"🟡 Lokaler Token ungültig, versuche Neu-Login... ({e})")
            (TOKEN_DIR / "garmin_tokens.json").unlink(missing_ok=True)

    # Weg 3: Interaktiver Login
    email, pw = get_credentials()
    log.info("Interaktiver Login (MFA-Code wird ggf. abgefragt)...")
    try:
        api = Garmin(email=email, password=pw, prompt_mfa=get_mfa)
        TOKEN_DIR.mkdir(mode=0o700, exist_ok=True)
        api.login(str(TOKEN_DIR))
        log.info(f"✓ Login — Token gespeichert: {TOKEN_DIR}/garmin_tokens.json")
        return api
    except GarminConnectAuthenticationError as e:
        log.error("🔴 LOGIN FEHLGESCHLAGEN: E-Mail/Passwort falsch oder Konto gesperrt!")
        log.error(f"   Details: {e}")
        sys.exit(1)


# ── Einzel-Tag Metriken ─────────────────────────────────────────────────────
def fetch_hrv(api, today_str, yesterday_str):
    raw = safe(lambda: api.get_hrv_data(today_str), "HRV heute")
    if raw is None:
        raw = safe(lambda: api.get_hrv_data(yesterday_str), "HRV gestern")
    result = {"lastNight": None, "status": "UNKNOWN", "weeklyAvg": None, "balancedLow": None, "balancedHigh": None}
    if not raw:
        return result
    summary = raw.get("hrvSummary", {})
    nightly = raw.get("lastNight", {})
    result["lastNight"]    = nightly.get("lastNight") or nightly.get("value")
    result["status"]       = summary.get("status", "UNKNOWN")
    result["weeklyAvg"]    = summary.get("weeklyAvg")
    result["balancedLow"]  = summary.get("balancedLow")
    result["balancedHigh"] = summary.get("balancedHigh")
    return result


def fetch_rhr(api, date_str):
    raw = safe(lambda: api.get_rhr_day(date_str), f"RHR {date_str}")
    if not raw:
        return None
    try:
        metrics  = raw.get("allMetrics", {}).get("metricsMap", {})
        rhr_list = metrics.get("WELLNESS_RESTING_HEART_RATE", [])
        if rhr_list:
            return rhr_list[0].get("value")
    except Exception:
        pass
    return raw.get("restingHeartRate") or raw.get("value")


def fetch_sleep_day(api, date_str):
    raw = safe(lambda: api.get_sleep_data(date_str), f"Schlaf {date_str}")
    if not raw:
        return {}
    dto = raw.get("dailySleepDTO", {})
    scores = dto.get("sleepScores", {}).get("overall", {})
    return {
        "score":        scores.get("value") or dto.get("sleepScore"),
        "totalSeconds": dto.get("sleepTimeSeconds"),
        "deepSeconds":  dto.get("deepSleepSeconds"),
        "lightSeconds": dto.get("lightSleepSeconds"),
        "remSeconds":   dto.get("remSleepSeconds"),
        "awakeSeconds": dto.get("awakeSleepSeconds"),
    }


def fetch_stress_day(api, date_str):
    raw = safe(lambda: api.get_stress_data(date_str), f"Stress {date_str}")
    if not raw:
        return {}
    return {
        "avgStressLevel": raw.get("avgStressLevel"),
        "maxStressLevel": raw.get("maxStressLevel"),
    }


def fetch_vo2max(api, today_str):
    raw = safe(lambda: api.get_stats(today_str), "VO2max/Stats")
    if not raw:
        return None
    return raw.get("vo2Max") or raw.get("maxMetValue")


def fetch_fitness_age(api, today_str):
    """Fitnessalter aus get_stats() oder get_user_profile()."""
    raw = safe(lambda: api.get_stats(today_str), "Fitnessalter/Stats")
    if raw:
        age = raw.get("fitnessAge") or raw.get("biologicalAge")
        if age is not None:
            return int(age)
    profile = safe(lambda: api.get_user_profile(), "Fitnessalter/Profile")
    if profile:
        val = profile.get("fitnessAge") or profile.get("biologicalAge")
        if val is not None:
            return int(val)
    return None


def fetch_body_composition(api, start_str, end_str):
    """
    Garmin Index S2: Gewicht, Körperfett, Muskelmasse, Knochenmasse, Körperwasser, BMI.
    Gibt Liste [{date, weight, bmi, bodyFat, skeletalMuscle, boneMass, bodyWater}] zurück.
    """
    raw = safe(lambda: api.get_body_composition(start_str, end_str), "Body Composition")
    if not raw:
        return []

    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = (raw.get("dateWeightList")
                 or raw.get("bodyCompositionList")
                 or [])
    else:
        return []

    entries = []
    for item in items:
        d = (item.get("calendarDate") or item.get("date") or "")[:10]
        if not d:
            continue

        # Garmin speichert Gewicht und Knochenmasse intern in Gramm → Umrechnung in kg
        raw_weight   = item.get("weight")
        raw_bonemass = item.get("boneMass")
        weight_kg    = round(raw_weight   / 1000, 2) if raw_weight   is not None else None
        bonemass_kg  = round(raw_bonemass / 1000, 2) if raw_bonemass is not None else None

        # Muskelmasse: Index S2 liefert kein skeletalMuscle %, evtl. muscleMass in Gramm
        raw_muscle = item.get("skeletalMuscle") or item.get("muscleMass")
        muscle_val = None
        if raw_muscle is not None:
            # Wenn > 100 → wahrscheinlich Gramm → kg umrechnen
            muscle_val = round(raw_muscle / 1000, 1) if raw_muscle > 100 else round(raw_muscle, 1)

        entries.append({
            "date":        d,
            "weight":      weight_kg,          # kg
            "bmi":         round(item.get("bmi"), 1) if item.get("bmi") else None,
            "bodyFat":     item.get("bodyFat"),  # %
            "muscleMass":  muscle_val,           # kg oder %
            "boneMass":    bonemass_kg,           # kg
            "bodyWater":   item.get("bodyWater"), # %
        })

    entries.sort(key=lambda x: x["date"], reverse=True)
    return entries


def fetch_training_readiness(api, today_str):
    raw = safe(lambda: api.get_training_readiness(today_str), "Training Readiness")
    if not raw:
        return None
    if isinstance(raw, list) and raw:
        entry = raw[0]
        return entry.get("score") or entry.get("trainingReadinessScore")
    if isinstance(raw, dict):
        return raw.get("score") or raw.get("trainingReadinessScore")
    return None


# ── 30-Tage History ─────────────────────────────────────────────────────────
def fetch_body_battery_range(api, start_str, end_str):
    """Gibt dict date→{charged,drained,endValue} zurück."""
    result = {}
    raw = safe(lambda: api.get_body_battery(start_str, end_str), "Body Battery Range")
    if not raw or not isinstance(raw, list):
        return result
    for entry in raw:
        d = entry.get("date", "")
        if d:
            result[d] = {
                "charged":  entry.get("charged"),
                "drained":  entry.get("drained"),
                "endValue": entry.get("endValue"),
            }
    return result


def fetch_daily_steps_range(api, start_str, end_str):
    """Gibt dict date→steps zurück."""
    result = {}
    # Versuche Range-Call zuerst
    raw = safe(lambda: api.get_daily_steps_data(start_str, end_str), "Steps Range")
    if raw and isinstance(raw, list):
        for item in raw:
            d = (item.get("calendarDate") or item.get("startGMT", "")[:10] or "").strip()
            steps = item.get("totalSteps") or item.get("steps")
            if d and steps is not None:
                result[d] = steps
    return result


def fetch_activities_list(api, limit=30):
    raw = safe(lambda: api.get_activities(0, limit), "Aktivitätsliste")
    if not raw or not isinstance(raw, list):
        return []
    out = []
    for a in raw:
        out.append({
            "date":            (a.get("startTimeLocal") or "")[:10],
            "name":            a.get("activityName", ""),
            "type":            a.get("activityType", {}).get("typeKey", ""),
            "distanceMeters":  a.get("distance"),
            "durationSeconds": a.get("duration"),
            "avgHr":           a.get("averageHR"),
            "maxHr":           a.get("maxHR"),
            "calories":        a.get("calories"),
        })
    return out


def build_history(api, today, bb_range, steps_range):
    """
    Baut das history.days Array für 30 Tage.
    Macht einen API-Call pro Tag für HRV / RHR / Schlaf / Stress.
    Kleine Sleep-Delays zwischen Tagen um Rate-Limiting zu vermeiden.
    """
    days = []
    for i in range(30):
        d = (today - timedelta(days=i)).isoformat()

        # Schnelle Daten aus Vorarbeiten
        bb    = bb_range.get(d, {})
        steps = steps_range.get(d)

        day = {
            "date":      d,
            "bbCharged": bb.get("charged"),
            "bbDrained": bb.get("drained"),
            "steps":     steps,
        }

        # Pro-Tag API-Calls (mit Delay)
        if i > 0:
            time.sleep(0.3)   # Rate-Limiting vermeiden

        # Sleep
        sleep = fetch_sleep_day(api, d)
        day["sleepScore"]   = sleep.get("score")
        day["sleepSeconds"] = sleep.get("totalSeconds")

        # Stress
        stress = fetch_stress_day(api, d)
        day["avgStress"] = stress.get("avgStressLevel")

        # RHR (nur alle 3 Tage um Rate-Limit zu schonen — täglich langsam)
        if i % 2 == 0:
            time.sleep(0.2)
        rhr = fetch_rhr(api, d)
        day["rhr"] = rhr

        # HRV (lastNight — oft null bei manchen Geräten)
        hrv_raw = safe(lambda dd=d: api.get_hrv_data(dd), f"HRV {d}")
        if hrv_raw:
            nightly = hrv_raw.get("lastNight", {})
            day["hrv"] = nightly.get("lastNight") or nightly.get("value")
        else:
            day["hrv"] = None

        days.append(day)
        log.info(f"  {d}: sleep={day['sleepScore']}, stress={day['avgStress']}, rhr={day['rhr']}, hrv={day['hrv']}, steps={steps}")

    return days   # newest first


# ── Hauptprogramm ───────────────────────────────────────────────────────────
def main():
    api = login()

    today     = date.today()
    today_str = today.isoformat()
    yest_str  = (today - timedelta(days=1)).isoformat()
    start_30  = (today - timedelta(days=29)).isoformat()

    log.info("════ Starte Datenabruf ════════════════════════════════════════")

    # ── Heutige Einzelwerte ─────────────────────────────────────────────────
    log.info("HRV...")
    hrv = fetch_hrv(api, today_str, yest_str)

    log.info("Ruhepuls heute...")
    rhr_today = fetch_rhr(api, today_str) or fetch_rhr(api, yest_str)

    log.info("Schlaf heute...")
    sleep = fetch_sleep_day(api, today_str)
    if not sleep.get("score"):
        sleep = fetch_sleep_day(api, yest_str)

    log.info("Stress heute...")
    stress = fetch_stress_day(api, today_str)

    log.info("VO2max...")
    vo2max = fetch_vo2max(api, today_str)

    log.info("Fitnessalter...")
    fitness_age = fetch_fitness_age(api, today_str)

    log.info("Training Readiness...")
    training_readiness = fetch_training_readiness(api, today_str)

    # ── Range-Abfragen (effizient) ──────────────────────────────────────────
    log.info("Body Battery (30 Tage Range)...")
    bb_range = fetch_body_battery_range(api, start_30, today_str)

    log.info("Körperdaten Index S2 (90 Tage)...")
    start_90 = (today - timedelta(days=89)).isoformat()
    body_composition = fetch_body_composition(api, start_90, today_str)

    log.info("Schritte (30 Tage Range)...")
    steps_range = fetch_daily_steps_range(api, start_30, today_str)

    log.info("Aktivitätsliste (30 Einträge)...")
    activities = fetch_activities_list(api, limit=30)

    # Heutige Body Battery aus Range
    bb_today = bb_range.get(today_str, {})
    body_battery = {
        "current":   bb_today.get("endValue"),
        "charged":   bb_today.get("charged"),
        "drained":   bb_today.get("drained"),
        "history":   sorted(
            [{"date": d, **v} for d, v in bb_range.items()],
            key=lambda x: x["date"], reverse=True
        )[:30],
    }

    # Heutige Schritte
    steps_today = steps_range.get(today_str)

    # Letzte Aktivität
    last_activity = activities[0] if activities else None

    # ── 30-Tage-History (Tag-für-Tag) ───────────────────────────────────────
    log.info("════ 30-Tage-History (dauert ~2 min) ══════════════════════════")
    history_days = build_history(api, today, bb_range, steps_range)

    log.info("════ Datenabruf abgeschlossen ══════════════════════════════════")

    # ── JSON zusammenstellen ────────────────────────────────────────────────
    data = {
        "updated_at":         datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        # Heutige Werte
        "hrv":                hrv,
        "bodyBattery":        body_battery,
        "restingHeartRate":   rhr_today,
        "sleep":              sleep,
        "stress":             stress,
        "vo2max":             vo2max,
        "fitnessAge":         fitness_age,
        "trainingReadiness":  training_readiness,
        "stepsToday":         steps_today,
        "lastActivity":       last_activity,
        # Körperdaten (Index S2) — neuester Eintrag zuerst
        "bodyComposition":    body_composition,
        # 30-Tage History
        "history": {
            "days":       history_days,
            "activities": activities,
        },
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    log.info(f"✓ Gespeichert → {OUT_PATH}")
    # Kurze Zusammenfassung
    latest_bc = body_composition[0] if body_composition else {}
    print(f"\n{'─'*50}")
    print(f"  Schlaf-Score:       {sleep.get('score')}")
    print(f"  HRV Status:         {hrv.get('status')}")
    print(f"  Ruhepuls:           {rhr_today} bpm")
    print(f"  Training Readiness: {training_readiness}")
    print(f"  Fitnessalter:       {fitness_age}")
    print(f"  Schritte heute:     {steps_today}")
    print(f"  Aktivitäten:        {len(activities)}")
    print(f"  History Tage:       {len(history_days)}")
    print(f"  Körperdaten:        {len(body_composition)} Einträge")
    if latest_bc:
        print(f"    → Gewicht: {latest_bc.get('weight')} kg  "
              f"Körperfett: {latest_bc.get('bodyFat')}%  "
              f"Muskeln: {latest_bc.get('skeletalMuscle')}%")
    print(f"{'─'*50}\n")


if __name__ == "__main__":
    main()
