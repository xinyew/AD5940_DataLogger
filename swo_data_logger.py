import subprocess
import datetime
import os
import matplotlib.pyplot as plt
import numpy as np

# --- Configuration ---
COMMANDER_CMD = 'commander swo read --device EFR32BG27 --serialno 440332818'
OUTPUT_DIR = r'/Users/xinye/Desktop/AD5940_DataLogger/Data'

# --- Plotting Configuration ---
PLOT_FIG_SIZE = (12, 7)
PLOT_AXES_GEOMETRY = [0.1, 0.1, 0.8, 0.8]
# ---------------------

def parse_line(line, state, data):
    """Parses a line of SWO data and updates the state and data."""
    new_state = state

    # "Device Name:" is the trigger for the start of a new data acquisition run
    # If we are already in the middle of a run, this indicates a new one is starting.
    # So, we should first save the data we've collected so far.
    if line.startswith('Device Name:'):
        if state not in ['waiting_for_data', 'initial']:
            print("\n--- New run detected by 'Device Name:'. Saving previous run. ---\n")
            save_data_and_plots(data)

        print("\n--- Resetting parser state for new run. ---\n")
        # Reset data for a new run
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

    # Ignore system logs that are not the device name trigger
    if line.startswith('[I]'):
        return new_state

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
        # Unlike before, we don't stop here. We'll wait for the next "Device Name:"
        # to signal the end of the complete measurement run.

    # The "finished" message can be used to trigger saving if it's the end of a session.
    if "SqrWave Voltammetry test finished" in line:
        if data['output_data']: # Only save if we have data
            print("\n--- 'Finished' message detected. Saving current run data. ---\n")
            save_data_and_plots(data)
            # Reset for a potential new run without a 'Device Name:' trigger
            new_state = 'waiting_for_data'
            data.clear()
            data.update({
                'device_name': None,
                'params': {},
                'voltage_steps': [],
                'output_data': []
            })
            
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

    # Handle uneven number of data points by discarding the last one
    if len(data['output_data']) % 2 != 0:
        print(f"Warning: Received an odd number of data points ({len(data['output_data'])}). Discarding the last point.")
        data['output_data'] = data['output_data'][:-1]

    raw_values = [val for _, val in data['output_data']]
    
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
        print("No device name found. Using 'default_device'.")
        data['device_name'] = 'default_device'

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

def main():
    """Main function to run the data logger."""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created base output directory: {OUTPUT_DIR}")

    print(f"Starting SWO data capture with command: {COMMANDER_CMD}")
    
    try:
        process = subprocess.Popen(COMMANDER_CMD, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True, bufsize=1)

        state = 'waiting_for_data'
        data = {
            'device_name': None,
            'params': {},
            'voltage_steps': [],
            'output_data': []
        }

        for line in iter(process.stdout.readline, ''):
            decoded_line = line.strip()
            if not decoded_line:
                continue

            print(decoded_line) # Print the raw output for debugging
            state = parse_line(decoded_line, state, data)

            if state == 'finished':
                save_data_and_plots(data)
                # Reset state to wait for the next run
                state = 'waiting_for_data'
        
        # Check for any errors at the end
        stderr_output = process.stderr.read()
        if stderr_output:
            print("\n--- Errors from commander ---")
            print(stderr_output)

    except FileNotFoundError:
        print(f"Error: The command '{COMMANDER_CMD.split()[0]}' was not found.")
        print("Please ensure the Simplicity Commander tool is installed and that its location is in your system's PATH.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

    print("SWO data capture finished.")

if __name__ == '__main__':
    main()