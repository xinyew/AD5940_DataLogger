# AD5940 Data Logger Project

This project contains a data logger for the AD5940 sensor, featuring a React frontend, a Node.js/Express backend, and Python scripts for BLE communication.

## 1. Environment Setup

### Python Virtual Environment (`venv`)

The Python scripts require specific libraries to run. Follow these steps to set up the virtual environment:

1.  **Create the virtual environment:**
    ```bash
    python3 -m venv venv
    ```

2.  **Activate the virtual environment:**
    *   **macOS/Linux:**
        ```bash
        source venv/bin/activate
        ```
    *   **Windows:**
        ```bash
        .\venv\Scripts\activate
        ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

    *Note: If `requirements.txt` is missing, manually install:*
    ```bash
    pip install bleak matplotlib numpy
    ```

## 2. Running the Application

### Backend (Node.js/Express)

The backend handles API requests and interfaces with the Python scripts.

1.  Navigate to the backend directory:
    ```bash
    cd App/backend
    ```

2.  Install dependencies (first time only):
    ```bash
    npm install
    ```

3.  Start the server:
    ```bash
    npm start
    ```
    The backend will typically run on `http://localhost:3000` (or the port defined in your `src/index.ts`).

### Frontend (React/Vite)

The frontend provides the user interface.

1.  Navigate to the frontend directory:
    ```bash
    cd App/frontend
    ```

2.  Install dependencies (first time only):
    ```bash
    npm install
    ```

3.  Start the development server:
    ```bash
    npm run dev
    ```
    This will give you a local URL (e.g., `http://localhost:5173`) to view the app in your browser.

## 3. Project Structure

*   **`App/frontend`**: React application.
*   **`App/backend`**: Node.js Express server.
*   **`Data`**: Directory where log files and plots are saved.
*   **`*.py`**: Python scripts for BLE communication and data logging.
    *   `ble_data_logger_wrapper.py`: Main wrapper interacting with BLE devices.
    *   `scan_ble_devices.py`: Helper to scan for available BLE devices.
    *   `swo_data_logger.py`: Logger for SWO trace data.

## 4. Git Information

To keep the repository clean, the following are ignored by Git:
*   `node_modules/` (in both frontend and backend)
*   `venv/` (Python virtual environment)
*   `Data/` (Generated logs and plots)
*   `dist/` (Build artifacts)
*   `*.lock` & `package-lock.json` files (as requested for this specific setup)

If you clone this repo, you **must** run the installation steps above to regenerate `node_modules` and `venv`.
