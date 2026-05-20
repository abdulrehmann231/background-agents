#!/usr/bin/env python3
"""
Test script that runs for 20 minutes, printing output every minute.
Used to verify that the activity detection script correctly identifies output as activity.
"""

import time
import sys

TOTAL_MINUTES = 20
INTERVAL_SECONDS = 60

print(f"Starting long-running test script ({TOTAL_MINUTES} minutes)")
print(f"Will print output every {INTERVAL_SECONDS} seconds")
print("-" * 50)
sys.stdout.flush()

for minute in range(1, TOTAL_MINUTES + 1):
    time.sleep(INTERVAL_SECONDS)
    print(f"[Minute {minute}/{TOTAL_MINUTES}] Still running... ({TOTAL_MINUTES - minute} minutes remaining)")
    sys.stdout.flush()

print("-" * 50)
print("Completed successfully!")
