import asyncio
import datetime
import os
import sys
import matplotlib.pyplot as plt
import numpy as np
from bleak import BleakScanner, BleakClient

# --- Configuration ---
# UUIDs retrieved from config/btconf/gatt_configuration.btconf
LOG_DATA_CHARACTERISTIC_UUID = "513eb430-89eb-4d7f-880d-7ee23aa0b593"
MEASUREMENT_DATA_CHARACTERISTIC_UUID = "dfe54d26-a9d5-4398-acf5-2585b41dd956"

# The name prefix to search for
DEVICE_NAME_PREFIX = "THOR"

# Output directory (Same as original script)
OUTPUT_DIR = r'/Users/xinye/Desktop/AD5940_DataLogger/Data'

# --- Plotting Configuration ---
PLOT_FIG_SIZE = (12, 7)
PLOT_AXES_GEOMETRY = [0.1, 0.1, 0.8, 0.8]
# ---------------------

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
        print("\n--- Resetting parser state for new run. ---\n")
        sys.stdout.flush()
        data.clear()
        data.update({
            'device_name': line.split(':', 1)[1].strip(),
            'params': {},
            'voltage_steps': [],
            'output_data': []
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
        elif "SqrWave Voltammetry test finished" in line:
            # This just marks the end of a chunk. We don't change state.
            print("--- Finished receiving a data chunk. Continuing... ---")
            sys.stdout.flush()
            
    return new_state

def generate_swv_plot(data, dir_name):
    """Generates and saves the SWV difference plot."""
    print("Attempting to generate SWV difference plot...")
    try:
        begin_volt_str = data['params'].get('Param_RampStartVolt')
        end_volt_str = data['params'].get('Param_RampPeakVolt')

        if begin_volt_str is None or end_volt_str is None:
            print("Warning: Could not get voltage range for SWV plot. 'RampStartVolt' or 'RampPeakVolt' not found.")
            return

        begin_volt = float(begin_volt_str)
        end_volt = float(end_volt_str)

    except (ValueError) as e:
        print(f"Warning: Could not parse voltage range for SWV plot. Error: {e}")
        return

    # Copy data to avoid modifying the original list in `data`
    output_data = list(data['output_data'])
    # Handle uneven number of data points by discarding the last one
    if len(output_data) % 2 != 0:
        print(f"Warning: Received an odd number of data points ({len(output_data)}). Discarding the last point for plotting.")
        output_data = output_data[:-1]

    raw_values = [val for _, val in output_data]
    
    if len(raw_values) < 2:
        print("Warning: Not enough data points to create SWV plot.")
        return

    differences = [raw_values[i+1] - raw_values[i] for i in range(0, len(raw_values), 2)]

    num_plot_points = len(differences)
    if num_plot_points == 0:
        print("Warning: No difference data to plot for SWV.")
        return

    scale_factor = end_volt - begin_volt
    x_coords_to_plot = [begin_volt + i * scale_factor / num_plot_points for i in range(num_plot_points)]

    fig = plt.figure(figsize=PLOT_FIG_SIZE)
    ax = fig.add_axes(PLOT_AXES_GEOMETRY)
    ax.plot(x_coords_to_plot, differences, linestyle='-')
    ax.set_title("SWV Difference Plot")
    ax.set_xlabel("Voltage (mV)")
    ax.set_ylabel("Current Diff (uA)")
    ax.grid(True)
    fig.savefig(os.path.join(dir_name, 'swv_difference_plot.png'))
    plt.close(fig)
    print("Successfully generated SWV difference plot.")

def save_data_and_plots(data):
    """Saves the collected data and generates plots."""
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

    np.savetxt(os.path.join(full_dir_path, 'voltage_steps.csv'), np.array(data['voltage_steps']), delimiter=',', header='Voltage (mV)', comments='')

    output_array = np.array(data['output_data'])
    if output_array.size > 0:
      np.savetxt(os.path.join(full_dir_path, 'output_data.csv'), output_array, delimiter=',', header='Index,Value', comments='')

    if data['voltage_steps']:
        fig = plt.figure(figsize=PLOT_FIG_SIZE)
        ax = fig.add_axes(PLOT_AXES_GEOMETRY)
        ax.plot(data['voltage_steps'])
        ax.set_title('Voltage Steps')
        ax.set_xlabel('Step')
        ax.set_ylabel('Voltage (mV)')
        ax.grid(True)
        fig.savefig(os.path.join(full_dir_path, 'voltage_steps.png'))
        plt.close(fig)

    if output_array.size > 0:
        fig = plt.figure(figsize=PLOT_FIG_SIZE)
        ax = fig.add_axes(PLOT_AXES_GEOMETRY)
        ax.plot(output_array[:, 0], output_array[:, 1])
        ax.set_title('Output Data')
        ax.set_xlabel('Index')
        ax.set_ylabel('Value')
        ax.grid(True)
        fig.savefig(os.path.join(full_dir_path, 'output_data.png'))
        plt.close(fig)
    
    generate_swv_plot(data, full_dir_path)

    print("Finished saving results.")
    sys.stdout.flush()

async def main():
    """Main function to run the BLE data logger."""
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
        print(f"Scanning for BLE devices named '{DEVICE_NAME_PREFIX}...'")
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
                    print(f"DEBUG: Input received: '{user_input}'")
                    sys.stdout.flush()

                    if user_input == 'TRIGGER':
                        # Trigger measurement by reading the characteristic
                        print(f"Triggering measurement via UUID {MEASUREMENT_DATA_CHARACTERISTIC_UUID}...")
                        sys.stdout.flush()
                        try:
                            await client.read_gatt_char(MEASUREMENT_DATA_CHARACTERISTIC_UUID)
                            # Note: The data comes back via notifications, so we ignore the read result here.
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
