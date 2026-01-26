import asyncio
import datetime
import os
import sys
import numpy as np
import struct
import json
from bleak import BleakScanner, BleakClient

# --- Configuration ---
# UUIDs retrieved from config/btconf/gatt_configuration.btconf
LOG_DATA_CHARACTERISTIC_UUID = "513eb430-89eb-4d7f-880d-7ee23aa0b593"
MEASUREMENT_DATA_CHARACTERISTIC_UUID = "dfe54d26-a9d5-4398-acf5-2585b41dd956"
WRITE_CHARACTERISTIC_UUID = "b36186fc-e0d3-4351-81fe-461c0aaa9588"

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
            sys.stdout.flush()
            save_data_and_plots(data)

        # Reset data for the new run.
        print("\n--- Resetting parser state for new run. ---")
        sys.stdout.flush()
        data.clear()
        data.update({
            'device_name': line.split(':', 1)[1].strip(),
            'params': {},
            'voltage_steps': [],
            'output_data': [],
            'first_point_is_suspect': False
        })
        print(f"Found device: {data['device_name']}")
        sys.stdout.flush()
        new_state = 'parsing_params'
        print("Parsing parameters...")
        sys.stdout.flush()
        return new_state

    # Handle the case where 'Data Output:' is missing before index lines
    if state == 'voltage_steps' and line.startswith('index:'):
        print("INFO: 'index:' detected while in 'voltage_steps' state. Switching to data parsing.")
        sys.stdout.flush()
        new_state = 'data_output'
        state = 'data_output' # Immediately update state for this line's processing
        data['first_point_is_suspect'] = True

    if state == 'parsing_params':
        if line.startswith('Param_'):
            parts = line.split(':', 1)
            if len(parts) == 2:
                key, value = parts
                data['params'][key.strip()] = value.strip()
        elif line.startswith('Voltage Steps:'):
            new_state = 'voltage_steps'
            print("Parsing voltage steps...")
            sys.stdout.flush()
    
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
            sys.stdout.flush()

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
        elif line.startswith('Data Output:'):
            # If we see an explicit 'Data Output:' header, it means any data we collected
            # before this (via the 'missing header' logic) might be stale/stray packets.
            # We should clear the buffer to ensure a clean start.
            print("INFO: Explicit 'Data Output:' header detected in data_output state. Clearing pre-buffered data.")
            sys.stdout.flush()
            data['output_data'] = []
            data['first_point_is_suspect'] = False
        elif "SqrWave Voltammetry test finished" in line:
            # This just marks the end of a chunk. We don't change state.
            current_len = len(data.get('output_data', []))
            print(f"--- Finished receiving a data chunk. Data len: {current_len} ---")
            sys.stdout.flush()

            if data.get('output_data'):
                 print("--- Saving complete run. ---")
                 sys.stdout.flush()
                 save_data_and_plots(data)
                 # Reset data containers but keep device name
                 data['params'] = {}
                 data['voltage_steps'] = []
                 data['output_data'] = []
                 data['first_point_is_suspect'] = False
                 # Reset state
                 new_state = 'waiting_for_data'
            else:
                 print("--- No data to save. ---")
            sys.stdout.flush()
            
    return new_state

def save_data_and_plots(data):
    """Saves the collected data."""
    if not data.get('device_name'):
        print("No device name found, cannot save. Skipping.")
        return
    
    if not data.get('output_data'):
        print("No output data collected, cannot save. Skipping.")
        return

    # Handle suspect first data point (stray packet)
    if data.get('first_point_is_suspect', False) and len(data['output_data']) > 1:
        first_point = data['output_data'].pop(0)
        print(f"Warning: Discarding suspect first data point (index: {first_point[0]}, value: {first_point[1]}).")

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
    sys.stdout.flush()

def pack_swv_params(params):
    # Header: CommandType (1 for SWV) - uint32
    # RampStartVolt (float)
    # RampPeakVolt (float)
    # Frequency (float)
    # SqrWvAmplitude (float)
    # SqrWvRampIncrement (float)
    # SampleDelay (float)
    # LPTIARtiaSel (uint32)
    
    cmd_type = 1
    return struct.pack('<IffffffI', 
        cmd_type,
        float(params.get('RampStartVolt', -0.5)),
        float(params.get('RampPeakVolt', 0.5)),
        float(params.get('Frequency', 5.0)),
        float(params.get('SqrWvAmplitude', 0.05)),
        float(params.get('SqrWvRampIncrement', 0.01)),
        float(params.get('SampleDelay', 1.0)),
        int(params.get('LPTIARtiaSel', 1000))
    )

def pack_cv_params(params):
    # Header: CommandType (2 for CV) - uint32
    # RampStartVolt (float)
    # RampPeakVolt (float)
    # StepNumber (uint32)
    # RampDuration (uint32)
    # SampleDelay (float)
    # LPTIARtiaSel (uint32)
    # bRampOneDir (uint32)

    cmd_type = 2
    return struct.pack('<IffIIfII', 
        cmd_type,
        float(params.get('RampStartVolt', -0.5)),
        float(params.get('RampPeakVolt', 0.5)),
        int(params.get('StepNumber', 100)),
        int(params.get('RampDuration', 10000)),
        float(params.get('SampleDelay', 1.0)),
        int(params.get('LPTIARtiaSel', 1000)),
        int(params.get('bRampOneDir', 0))
    )

async def main():
    """Main function to run the BLE data logger."""
    print(f"DEBUG: sys.argv: {sys.argv}")
    sys.stdout.flush()
    global OUTPUT_DIR
    if len(sys.argv) > 2:
        OUTPUT_DIR = sys.argv[2]
        print(f"Output directory set to: {OUTPUT_DIR}")
    
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created base output directory: {OUTPUT_DIR}")

    # --- CLI Interface: Read Target Device Name ---
    # The Node.js wrapper will pass the device name as an argument
    target_device_name = None
    if len(sys.argv) > 1:
        target_device_name = sys.argv[1]
    
    # If no specific name provided, scan for PREFIX
    if not target_device_name:
        print(f"Scanning for BLE devices named '{DEVICE_NAME_PREFIX}'...")
        sys.stdout.flush()
        target_device = None
        devices = await BleakScanner.discover()
        for d in devices:
            if d.name and d.name.startswith(DEVICE_NAME_PREFIX):
                target_device = d
                break
    else:
        # Scan specifically for the provided name
        print(f"Scanning for BLE device: '{target_device_name}'...")
        sys.stdout.flush()
        target_device = None
        devices = await BleakScanner.discover()
        for d in devices:
            if d.name == target_device_name:
                target_device = d
                break

    if not target_device:
        print(f"No device found.")
        sys.stdout.flush()
        return

    print(f"Found device: {target_device.name} ({target_device.address})")
    print("Connecting...")
    sys.stdout.flush()

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
            
        rx_buffer += chunk
        
        # Process complete lines
        while '\n' in rx_buffer:
            line, rx_buffer = rx_buffer.split('\n', 1)
            line = line.strip()
            if line:
                print(line)
                sys.stdout.flush()
                context['state'] = parse_line(line, context['state'], context['data'])

    try:
        async with BleakClient(target_device.address) as client:
            print(f"Connected: {client.is_connected}")
            
            # 1. Subscribe to Log Data (Notifications)
            if LOG_DATA_CHARACTERISTIC_UUID:
                 print(f"Subscribing to Log Data characteristic: {LOG_DATA_CHARACTERISTIC_UUID}")
                 sys.stdout.flush()
                 try:
                     await client.start_notify(LOG_DATA_CHARACTERISTIC_UUID, notification_handler)
                 except Exception as e:
                     print(f"Error subscribing to Log Data: {e}")
                     sys.stdout.flush()
                     return
            else:
                 print("Error: LOG_DATA_CHARACTERISTIC_UUID is not defined.")
                 sys.stdout.flush()
                 return

            print("READY") # Signal to Node.js that we are ready
            sys.stdout.flush()

            # Loop to listen for standard input
            loop = asyncio.get_running_loop()
            while True:
                # Use run_in_executor to wait for input without blocking the BLE loop
                try:
                    user_input = await loop.run_in_executor(None, sys.stdin.readline)
                    if not user_input:
                        break # EOF
                    
                    user_input = user_input.strip()
                    if not user_input:
                        continue

                    print(f"DEBUG: Input received: '{user_input}'")
                    sys.stdout.flush()

                    if user_input.startswith('START_MEASUREMENT'):
                        # Parse JSON payload
                        try:
                            json_str = user_input[len('START_MEASUREMENT'):].strip()
                            params = json.loads(json_str)
                            print(f"Preparing to write parameters: {params}")
                            
                            meas_type = params.get('type')
                            payload = None
                            
                            if meas_type == 'SWV':
                                payload = pack_swv_params(params)
                            elif meas_type == 'CV':
                                payload = pack_cv_params(params)
                            else:
                                print(f"Unknown measurement type: {meas_type}")

                            if payload:
                                print(f"Writing {len(payload)} bytes to {WRITE_CHARACTERISTIC_UUID}")
                                sys.stdout.flush()
                                await client.write_gatt_char(WRITE_CHARACTERISTIC_UUID, payload)
                                print("Command sent successfully.")
                            
                        except Exception as e:
                            print(f"Failed to process measurement command: {e}")
                            sys.stdout.flush()

                    elif user_input == 'TRIGGER':
                        # Legacy Trigger
                        print(f"Triggering measurement via UUID {MEASUREMENT_DATA_CHARACTERISTIC_UUID}...")
                        sys.stdout.flush()
                        try:
                            await client.read_gatt_char(MEASUREMENT_DATA_CHARACTERISTIC_UUID)
                        except Exception as e:
                            print(f"Failed to trigger measurement: {e}")
                            sys.stdout.flush()
                    elif user_input == 'QUIT':
                        print("Quitting...")
                        break
                except ValueError:
                    # Handle potential errors with stdin (e.g. if closed)
                    break

    except asyncio.CancelledError:
        print("Disconnecting...")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        # Save any remaining data
        if context['data'].get('output_data'):
             print("\n--- Saving final data set before exit. ---\n")
             save_data_and_plots(context['data'])
        print("DISCONNECTED")
        sys.stdout.flush()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
