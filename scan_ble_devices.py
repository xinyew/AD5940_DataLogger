import asyncio
from bleak import BleakScanner

DEVICE_NAME_PREFIX = "THOR"

async def main():
    devices = await BleakScanner.discover()
    found_devices = []
    for d in devices:
        if d.name and d.name.startswith(DEVICE_NAME_PREFIX):
            found_devices.append(d.name)
    
    # Print as JSON for easy parsing in Node.js
    import json
    print(json.dumps(found_devices))

if __name__ == '__main__':
    asyncio.run(main())
