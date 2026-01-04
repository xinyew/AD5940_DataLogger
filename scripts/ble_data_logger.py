import asyncio
import datetime
import os
import sys
import numpy as np
from bleak import BleakScanner, BleakClient

# --- Configuration ---
# UUIDs retrieved from config/btconf/gatt_configuration.btconf
LOG_DATA_CHARACTERISTIC_UUID = "513eb430-89eb-4d7f-880d-7ee23aa0b593"
MEASUREMENT_DATA_CHARACTERISTIC_UUID = "dfe54d26-a9d5-4398-acf5-2585b41dd956"

# The name prefix to search for
DEVICE_NAME_PREFIX = "THOR"

# Output directory (Default)
OUTPUT_DIR = 'Data'

# Global buffer for reassembling fragmented BLE packets
rx_buffer = ""

def parse_line(line, state, data):
    """Parses a line of data and updates the state and data."""
    new_state = state

    # "Device Name:" is the trigger to save the PREVIOUS run and start a new one.
    if line.startswith('Device Name:'):
        # If we have collected actual data points, it means a run was in progress.
        if data.get('output_data'):
            print("\n--- New run detected by 'Device Name:'. Saving previously collected run. ---\n")
            save_data_and_plots(data)

        # Reset data for the new run.
        print("\n--- Resetting parser state for new run. ---\n")
        data.clear()
        data.update({
            'device_name': line.split(':', 1)[1].strip(),
            'params': {},
            'voltage_steps': [],
            'output_data': []
        })
        print(f"Found device: {data['device_name']}")
        new_state = 'parsing_params'
        print("Parsing parameters...")
        return new_state

    # Handle the case where 'Data Output:' is missing before index lines
    if state == 'voltage_steps' and line.startswith('index:'):
        print("INFO: 'index:' detected while in 'voltage_steps' state. Switching to data parsing.")
        new_state = 'data_output'
        state = 'data_output' # Immediately update state for this line's processing

    if state == 'parsing_params':
        if line.startswith('Param_'):
            parts = line.split(':', 1)
            if len(parts) == 2:
                key, value = parts
                data['params'][key.strip()] = value.strip()
        elif line.startswith('Voltage Steps:'):
            new_state = 'voltage_steps'
            print("Parsing voltage steps...")
    
    elif state == 'voltage_steps':
        if line.startswith("Voltage Step:"):
            try:
                voltage_str = line.split(':')[1].split('mV')[0].strip()
                voltage_mv = float(voltage_str)
                data['voltage_steps'].append(voltage_mv)
            except (ValueError, IndexError):
                pass
        elif line.startswith('Data Output:'):
            new_state = 'data_output'
            print("Parsing data output...")

    elif state == 'data_output':
        if line.startswith('index:'):
            try:
                parts = line.split(',')
                if len(parts) >= 2:
                    index = int(parts[0].split(':')[1].strip())
                    value = float(parts[1].strip())
                    data['output_data'].append((index, value))
            except (ValueError, IndexError):
                pass
        elif "SqrWave Voltammetry test finished" in line:
            # This just marks the end of a chunk. We don't change state.
            print("--- Finished receiving a data chunk. Continuing... ---")
            
    return new_state

def save_data_and_plots(data):
    """Saves the collected data."""
    if not data.get('device_name'):
        print("No device name found, cannot save. Skipping.")
        return
    
    if not data.get('output_data'):
        print("No output data collected, cannot save. Skipping.")
        return

    timestamp = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    run_dir_name = f"{timestamp}_{data['device_name']}"
    
    full_dir_path = os.path.join(OUTPUT_DIR, run_dir_name)

    os.makedirs(full_dir_path, exist_ok=True)
    print(f"Saving results to directory: {full_dir_path}")

    with open(os.path.join(full_dir_path, 'parameters.txt'), 'w') as f:
        f.write(f"Device Name: {data['device_name']}\n")
        for key, value in data['params'].items():
            f.write(f"{key}: {value}\n")

    if data['voltage_steps']:
        np.savetxt(os.path.join(full_dir_path, 'voltage_steps.csv'), np.array(data['voltage_steps']), delimiter=',', header='Voltage (mV)', comments='')

    output_array = np.array(data['output_data'])
    if output_array.size > 0:
      np.savetxt(os.path.join(full_dir_path, 'output_data.csv'), output_array, delimiter=',', header='Index,Value', comments='')

    print("Finished saving results.")

async def main():
    """Main function to run the BLE data logger."""
    global OUTPUT_DIR
    if len(sys.argv) > 1:
        OUTPUT_DIR = sys.argv[1]
        print(f"Output directory set to: {OUTPUT_DIR}")

    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created base output directory: {OUTPUT_DIR}")

    print(f"Scanning for BLE devices named '{DEVICE_NAME_PREFIX}'...")
    
    target_device = None
    devices = await BleakScanner.discover()
    for d in devices:
        if d.name and d.name.startswith(DEVICE_NAME_PREFIX):
            target_device = d
            break
            
    if not target_device:
        print(f"No device found with name starting with '{DEVICE_NAME_PREFIX}'.")
        return

    print(f"Found device: {target_device.name} ({target_device.address})")
    print("Connecting...")

    # Shared state for the parser
    context = {
        'state': 'waiting_for_data',
        'data': {}
    }

    def notification_handler(sender, data):
        global rx_buffer
        # Decode the received bytes to string
        try:
            chunk = data.decode('utf-8')
        except UnicodeDecodeError:
            print(f"Warning: Received non-UTF-8 data: {data}")
            return
            
        print(chunk, end='', flush=True) # Mirror output to console
        
        rx_buffer += chunk
        
        # Process complete lines
        while '\n' in rx_buffer:
            line, rx_buffer = rx_buffer.split('\n', 1)
            line = line.strip()
            if line:
                context['state'] = parse_line(line, context['state'], context['data'])

    try:
        async with BleakClient(target_device.address) as client:
            print(f"Connected: {client.is_connected}")
            
            # 1. Subscribe to Log Data (Notifications)
            if LOG_DATA_CHARACTERISTIC_UUID:
                 print(f"Subscribing to Log Data characteristic: {LOG_DATA_CHARACTERISTIC_UUID}")
                 try:
                     await client.start_notify(LOG_DATA_CHARACTERISTIC_UUID, notification_handler)
                 except Exception as e:
                     print(f"Error subscribing to Log Data: {e}")
                     return
            else:
                 print("Error: LOG_DATA_CHARACTERISTIC_UUID is not defined.")
                 return

            # 2. Loop to listen for user input and trigger measurements
            print("\n" + "="*50)
            print("Listening for data...")
            print(f"Press 'ENTER' to trigger measurement (sends read request to {MEASUREMENT_DATA_CHARACTERISTIC_UUID}).")
            print("Type 'q' and press 'ENTER' to quit.")
            print("="*50 + "\n")

            loop = asyncio.get_running_loop()
            
            while True:
                # Use run_in_executor to wait for input without blocking the BLE loop
                user_input = await loop.run_in_executor(None, input, "")
                user_input = user_input.strip()

                if user_input.lower() == 'q':
                    print("Quitting...")
                    break
                
                # Trigger measurement by reading the characteristic
                print(f"Triggering measurement via UUID {MEASUREMENT_DATA_CHARACTERISTIC_UUID}...")
                try:
                    await client.read_gatt_char(MEASUREMENT_DATA_CHARACTERISTIC_UUID)
                    # Note: The data comes back via notifications, so we ignore the read result here.
                except Exception as e:
                    print(f"Failed to trigger measurement: {e}")

    except asyncio.CancelledError:
        print("Disconnecting...")
    except KeyboardInterrupt:
        print("User stopped script.")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        # Save any remaining data
        if context['data'].get('output_data'):
             print("\n--- Saving final data set before exit. ---\n")
             save_data_and_plots(context['data'])

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
