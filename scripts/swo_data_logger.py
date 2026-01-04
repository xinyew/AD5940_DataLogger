import subprocess
import datetime
import os
import sys
import numpy as np

# --- Configuration ---
COMMANDER_CMD = 'commander swo read --device EFR32BG27 --serialno 801056273'
OUTPUT_DIR = 'Data'

def parse_line(line, state, data):
    """Parses a line of SWO data and updates the state and data."""
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
            key, value = line.split(':', 1)
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

def main():
    """Main function to run the data logger."""
    global OUTPUT_DIR
    if len(sys.argv) > 1:
        OUTPUT_DIR = sys.argv[1]
        print(f"Output directory set to: {OUTPUT_DIR}")

    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created base output directory: {OUTPUT_DIR}")

    print(f"Starting SWO data capture with command: {COMMANDER_CMD}")

    process = None
    state = 'waiting_for_data'
    data = {}
    
    try:
        process = subprocess.Popen(COMMANDER_CMD, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True, bufsize=1)

        for line in iter(process.stdout.readline, ''):
            decoded_line = line.strip()
            if not decoded_line:
                continue

            print(decoded_line) 
            state = parse_line(decoded_line, state, data)
        
        # After the loop finishes (commander process ends), save any lingering data.
        if data.get('output_data'):
            print("\n--- End of stream. Saving final data set. ---\n")
            save_data_and_plots(data)

    except KeyboardInterrupt:
        print("\n\n--- Keyboard Interrupt detected. ---")
        if data.get('output_data'):
            print("--- Saving any buffered data before exiting. ---\n")
            save_data_and_plots(data)
        print("--- Capture stopped by user. ---")

    except Exception as e:
        print(f"An unexpected error occurred: {e}")

    finally:
        if process:
            process.terminate()

    print("SWO data capture finished.")

if __name__ == '__main__':
    main()
