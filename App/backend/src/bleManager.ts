import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';

export class BleManager extends EventEmitter {
    private process: ChildProcess | null = null;
    private connectedDevice: string | null = null;
    private rootDir: string;
    private logBuffer: string[] = [];

    constructor(rootDir: string) {
        super();
        // rootDir passed from index.ts is likely the 'Data' dir, but we need the project root where python scripts are.
        // Assuming dataDir is .../AD5940_DataLogger/Data, project root is .../AD5940_DataLogger
        this.rootDir = path.resolve(rootDir, '..');
    }

    public async scanDevices(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const pythonPath = path.join(this.rootDir, 'venv/bin/python3');
            const scriptPath = path.join(this.rootDir, 'scan_ble_devices.py');
            const cmd = spawn(pythonPath, [scriptPath]);
            let stdout = '';
            let stderr = '';

            cmd.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            cmd.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            cmd.on('close', (code) => {
                if (code === 0) {
                    try {
                        const devices = JSON.parse(stdout.trim());
                        resolve(devices);
                    } catch (e) {
                        console.error("Failed to parse scan output:", stdout);
                        resolve([]);
                    }
                } else {
                    console.error("Scan script failed:", stderr);
                    reject(new Error('Failed to scan devices'));
                }
            });
        });
    }

    public connect(deviceName: string) {
        if (this.process) {
            throw new Error('Already connected to a device');
        }

        this.logBuffer = []; // Clear previous logs
        const pythonPath = path.join(this.rootDir, 'venv/bin/python3');
        const scriptPath = path.join(this.rootDir, 'ble_data_logger_wrapper.py');
        console.log(`Spawning BLE wrapper for device: ${deviceName}`);
        this.process = spawn(pythonPath, [scriptPath, deviceName], {
            stdio: ['pipe', 'pipe', 'pipe'] // Allow stdin writing
        });
        
        this.connectedDevice = deviceName;

        if (this.process.stdout) {
            this.process.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                const lines = text.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed) {
                        this.logBuffer.push(trimmed);
                        if (this.logBuffer.length > 10000) this.logBuffer.shift(); // Keep last 10000 lines

                        if (trimmed === 'READY') {
                            this.emit('connected', deviceName);
                        } else if (trimmed === 'DISCONNECTED') {
                            this.emit('disconnected');
                            this.cleanup();
                        }
                    }
                }
            });
        }

        this.process.stderr?.on('data', (data) => {
            const errorMsg = data.toString();
            console.error(`[BLE Error]: ${errorMsg}`);
            this.logBuffer.push(`[ERROR]: ${errorMsg}`);
        });

        this.process.on('close', (code) => {
            console.log(`BLE process exited with code ${code}`);
            this.cleanup();
        });
    }

    public disconnect() {
        if (this.process) {
            this.process.stdin?.write('QUIT\n');
            // Give it a moment to clean up, then kill if needed
            setTimeout(() => {
                if (this.process) {
                    this.process.kill();
                    this.cleanup();
                }
            }, 2000);
        }
    }

    public triggerRead() {
        if (this.process) {
            this.process.stdin?.write('TRIGGER\n');
        } else {
            throw new Error('Not connected');
        }
    }

    public getStatus() {
        return {
            connected: this.process !== null,
            deviceName: this.connectedDevice
        };
    }

    public getLogs() {
        return this.logBuffer;
    }

    private cleanup() {
        this.process = null;
        this.connectedDevice = null;
        this.emit('disconnected');
    }
}
