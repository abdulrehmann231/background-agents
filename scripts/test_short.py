#!/usr/bin/env python3
"""
Quick test script - 2 minutes, prints every 30 seconds.
Used to verify activity detection without waiting 20 minutes.
"""

import time
import sys

TOTAL_SECONDS = 120  # 2 minutes
INTERVAL = 30  # Print every 30 seconds

print(f"Starting short test ({TOTAL_SECONDS}s total, output every {INTERVAL}s)")
sys.stdout.flush()

elapsed = 0
while elapsed < TOTAL_SECONDS:
    time.sleep(INTERVAL)
    elapsed += INTERVAL
    print(f"[{elapsed}s/{TOTAL_SECONDS}s] Output generated - should reset idle timer")
    sys.stdout.flush()

print("Test completed successfully!")
