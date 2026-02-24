import redis.asyncio as redis
import asyncio
import json
from datetime import datetime
from collections import defaultdict


async def debug_options_cache():
    try:
        client = aioredis.from_url('redis://localhost:6379/0', decode_responses=True)
        await client.ping()
        print("✅ Redis connection successful.")
    except Exception as e:
        print(f"❌ Could not connect to Redis: {e}")
        return

    print("-" * 50)
    print("## Step 1: Scanning for ALL existing options keys...")

    options_keys = await client.keys("cache:options:*")
    print(f"Found {len(options_keys)} total keys with the 'cache:options:*' pattern.")

    # Group keys by symbol and type
    key_groups = defaultdict(lambda: {"tier1": [], "tier2_contracts": [], "tier2_volume": []})

    for key in options_keys:
        parts = key.replace("cache:options:", "").split("_")
        if len(parts) >= 3:
            symbol = parts[0]
            if "tier1" in key:
                key_groups[symbol]["tier1"].append(key)
            elif "tier2_contracts" in key:
                key_groups[symbol]["tier2_contracts"].append(key)
            elif "tier2_volume" in key:
                key_groups[symbol]["tier2_volume"].append(key)

    print("\nKey summary by symbol:")
    for symbol, types in sorted(key_groups.items())[:10]:
        print(f"\n{symbol}:")
        print(f"  - Tier 1 snapshots: {len(types['tier1'])}")
        print(f"  - Tier 2 contracts: {len(types['tier2_contracts'])} dates")
        print(f"  - Tier 2 volume: {len(types['tier2_volume'])} dates")

        if types['tier2_contracts']:
            dates = [k.split('_')[-1] for k in types['tier2_contracts']]
            print(f"    Contract dates: {', '.join(sorted(dates)[-3:])}")

    print("-" * 50)

    print("## Step 2: Checking actual cached data...")

    symbols_to_check = ['GOOG', 'META', 'AAPL', 'MSFT', 'NVDA']

    for symbol in symbols_to_check:
        print(f"\n--- {symbol} ---")

        # Check what dates we actually have for this symbol
        symbol_keys = [k for k in options_keys if k.startswith(f"cache:options:{symbol}_")]

        tier1_keys = [k for k in symbol_keys if "tier1" in k]
        tier2_contract_keys = [k for k in symbol_keys if "tier2_contracts" in k]
        tier2_volume_keys = [k for k in symbol_keys if "tier2_volume" in k]

        print(f"  Tier 1: {'✅ YES' if tier1_keys else '❌ NO'}")
        print(f"  Tier 2 Contracts: {len(tier2_contract_keys)} dates cached")
        print(f"  Tier 2 Volume: {len(tier2_volume_keys)} dates cached")

        if tier2_contract_keys:
            latest_contract = sorted(tier2_contract_keys)[-1]
            print(f"  Latest contracts: {latest_contract.split('_')[-1]}")

    print("-" * 50)

    print("## Step 3: TTL Analysis...")

    ttl_analysis = {"tier1": [], "tier2": []}

    for key in options_keys[:20]:
        ttl = await client.ttl(key)
        if ttl > 0:
            if "tier1" in key:
                ttl_analysis["tier1"].append(ttl)
            else:
                ttl_analysis["tier2"].append(ttl)

    if ttl_analysis["tier1"]:
        avg_tier1_ttl = sum(ttl_analysis["tier1"]) / len(ttl_analysis["tier1"])
        print(f"Tier 1 average TTL: {avg_tier1_ttl:.0f} seconds (~{avg_tier1_ttl / 3600:.1f} hours)")
        print(f"  ⚠️ Expected: ~1 hour (3600 seconds)")

    if ttl_analysis["tier2"]:
        avg_tier2_ttl = sum(ttl_analysis["tier2"]) / len(ttl_analysis["tier2"])
        print(f"Tier 2 average TTL: {avg_tier2_ttl:.0f} seconds (~{avg_tier2_ttl / 86400:.1f} days)")
        print(f"  ⚠️ Expected: ~180 days (15552000 seconds)")
        print(f"  ❌ ISSUE: TTL is way too short! Should be 6 months, not 1 day!")

    await client.aclose()


if __name__ == "__main__":
    asyncio.run(debug_options_cache())