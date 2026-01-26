import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:4000';

const RtiaValues = [
    "0", "200", "1000", "2000", "3000", "4000", "6000", "8000", "10000", "12000", "16000", "20000", 
    "24000", "30000", "32000", "40000", "48000", "64000", "85000", "96000", "100000", "120000", 
    "128000", "160000", "196000", "256000", "512000"
];

interface ConnectionManagerProps {}

type MeasurementType = 'SWV' | 'CV';

interface MeasurementParams {
    RampStartVolt: number;
    RampPeakVolt: number;
    Frequency: number;
    SqrWvAmplitude: number;
    SqrWvRampIncrement: number;
    SampleDelay: number;
    LPTIARtiaSel: number; // Index in RtiaValues
    StepNumber: number;
    RampDuration: number;
    bRampOneDir: number; // 0 or 1
}

const defaultParams: MeasurementParams = {
    RampStartVolt: -0.5,
    RampPeakVolt: 0.5,
    Frequency: 25.0,
    SqrWvAmplitude: 0.05,
    SqrWvRampIncrement: 0.01,
    SampleDelay: 1.0,
    LPTIARtiaSel: 2000, // Default to a reasonable value like 2000 (index 3), but wait... 
                        // The default sets the VALUE, but we store the INDEX or VALUE? 
                        // Let's store the index to be consistent with the backend requirement.
                        // "2000" is at index 3.
    StepNumber: 100,
    RampDuration: 10000,
    bRampOneDir: 0
};

// Find default index for 2000
const defaultRtiaIndex = RtiaValues.indexOf("2000");

const ConnectionManager: React.FC<ConnectionManagerProps> = () => {
    // Connection State
    const [devices, setDevices] = useState<string[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string>('');
    const [status, setStatus] = useState<{ connected: boolean, deviceName: string | null }>({ connected: false, deviceName: null });
    const [loading, setLoading] = useState(false);
    const [showConnectModal, setShowConnectModal] = useState(false);
    
    // Logs State
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    // Measurement State
    const [showMeasureModal, setShowMeasureModal] = useState(false);
    const [measType, setMeasType] = useState<MeasurementType>('SWV');
    const [params, setParams] = useState<MeasurementParams>({
        ...defaultParams,
        LPTIARtiaSel: defaultRtiaIndex >= 0 ? defaultRtiaIndex : 3
    });

    const isReadingRef = useRef(false);

    const fetchStatus = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/status`);
            setStatus(res.data);
        } catch (error) {
            console.error("Failed to fetch status", error);
        }
    };

    const fetchLogs = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/logs`);
            setLogs(res.data);
        } catch (error) {
            console.error("Failed to fetch logs", error);
        }
    };

    const handleScroll = () => {
        if (logContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
            setAutoScroll(isAtBottom);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let interval: any;
        if (status.connected) {
            fetchLogs();
            interval = setInterval(fetchLogs, 1000);
        } else {
            setLogs([]);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [status.connected]);

    useEffect(() => {
        if (autoScroll && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, autoScroll]);

    const fetchDevices = async () => {
        try {
            setLoading(true);
            const res = await axios.get(`${API_URL}/api/devices`);
            setDevices(res.data);
            if (res.data.length > 0) setSelectedDevice(res.data[0]);
        } catch (error) {
            console.error("Failed to fetch devices", error);
            alert("Failed to scan for BLE devices.");
        } finally {
            setLoading(false);
        }
    };

    const handleConnectClick = async () => {
        await fetchDevices();
        setShowConnectModal(true);
    };

    const handleConnectSubmit = async () => {
        if (!selectedDevice) return;
        try {
            setLoading(true);
            await axios.post(`${API_URL}/api/connect`, { deviceName: selectedDevice });
            setShowConnectModal(false);
            fetchStatus();
        } catch (error: any) {
            console.error("Connection failed", error);
            alert(`Connection failed: ${error.response?.data?.error || error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDisconnect = async () => {
        if (!window.confirm("Stop logging?")) return;
        try {
            setLoading(true);
            await axios.post(`${API_URL}/api/disconnect`);
            fetchStatus();
        } catch (error: any) {
            console.error("Disconnect failed", error);
            alert(`Disconnect failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleParamChange = (key: keyof MeasurementParams, value: any) => {
        setParams(prev => ({ ...prev, [key]: value }));
    };

    const handleStartMeasurement = async () => {
        if (isReadingRef.current) return;
        isReadingRef.current = true;
        try {
            setLoading(true);
            const payload = {
                type: measType,
                ...params
            };
            console.log("Sending payload:", payload);
            await axios.post(`${API_URL}/api/trigger`, payload);
            setShowMeasureModal(false);
        } catch (error: any) {
            console.error("Failed to start measurement", error);
            alert(`Failed to start measurement: ${error.message}`);
        } finally {
            setLoading(false);
            isReadingRef.current = false;
        }
    };

    return (
        <div className="card sidebar-card mb-3">
            <div className="card-header">Connection</div>
            <div className="card-body">
                {status.connected ? (
                    <div>
                        <div className="d-flex gap-2 mb-3">
                            <button 
                                className="btn btn-danger flex-grow-1" 
                                onClick={handleDisconnect} 
                                disabled={loading}
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={`Disconnect ${status.deviceName || ''}`}
                            >
                                Disconnect
                            </button>
                            <button className="btn btn-primary" onClick={() => setShowMeasureModal(true)} disabled={loading}>
                                New Meas.
                            </button>
                        </div>

                        <div 
                            className="bg-dark text-light p-2 rounded" 
                            style={{ height: '150px', overflowY: 'auto', fontSize: '0.8rem', fontFamily: 'monospace' }}
                            ref={logContainerRef}
                            onScroll={handleScroll}
                        >
                            {logs.map((log, i) => (
                                <div key={i}>{log}</div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                ) : (
                    <button className="btn btn-success w-100" onClick={handleConnectClick} disabled={loading}>
                        Connect
                    </button>
                )}
            </div>

            {/* Connect Modal */}
            {showConnectModal && (
                <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">Select BLE Device</h5>
                                <button type="button" className="btn-close" onClick={() => setShowConnectModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                {loading ? <p>Scanning...</p> : (
                                    devices.length === 0 ? <p>No devices found.</p> : (
                                        <select className="form-select" value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
                                            {devices.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    )
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowConnectModal(false)}>Cancel</button>
                                <button type="button" className="btn btn-primary" onClick={handleConnectSubmit} disabled={!selectedDevice || loading}>
                                    Connect
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Measurement Modal */}
            {showMeasureModal && (
                <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-lg">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">New Measurement</h5>
                                <button type="button" className="btn-close" onClick={() => setShowMeasureModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                {/* Type Selection */}
                                <div className="mb-3">
                                    <label className="form-label fw-bold">Measurement Type</label>
                                    <div className="btn-group w-100">
                                        <input 
                                            type="radio" className="btn-check" name="measType" id="typeSWV" 
                                            checked={measType === 'SWV'} onChange={() => setMeasType('SWV')} 
                                        />
                                        <label className="btn btn-outline-primary" htmlFor="typeSWV">Square Wave (SWV)</label>

                                        <input 
                                            type="radio" className="btn-check" name="measType" id="typeCV" 
                                            checked={measType === 'CV'} onChange={() => setMeasType('CV')} 
                                        />
                                        <label className="btn btn-outline-primary" htmlFor="typeCV">Cyclic Voltammetry (CV)</label>
                                    </div>
                                </div>

                                <div className="row g-3">
                                    {/* Common Params */}
                                    <div className="col-md-6">
                                        <label className="form-label">Start Volt (mV)</label>
                                        <input type="number" step="0.01" className="form-control" 
                                            value={params.RampStartVolt} 
                                            onChange={(e) => handleParamChange('RampStartVolt', parseFloat(e.target.value))} 
                                        />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label">Peak Volt (mV)</label>
                                        <input type="number" step="0.01" className="form-control" 
                                            value={params.RampPeakVolt} 
                                            onChange={(e) => handleParamChange('RampPeakVolt', parseFloat(e.target.value))} 
                                        />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label">Sample Delay (ms)</label>
                                        <input type="number" step="0.1" className="form-control" 
                                            value={params.SampleDelay} 
                                            onChange={(e) => handleParamChange('SampleDelay', parseFloat(e.target.value))} 
                                        />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label">LPTIA Rtia Selection</label>
                                        <select 
                                            className="form-select" 
                                            value={params.LPTIARtiaSel} 
                                            onChange={(e) => handleParamChange('LPTIARtiaSel', parseInt(e.target.value))}
                                        >
                                            {RtiaValues.map((val, idx) => (
                                                <option key={idx} value={idx}>{val} Ohm</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* SWV Specific */}
                                    {measType === 'SWV' && (
                                        <>
                                            <div className="col-md-6">
                                                <label className="form-label">Frequency (Hz)</label>
                                                <input type="number" step="0.1" className="form-control" 
                                                    value={params.Frequency} 
                                                    onChange={(e) => handleParamChange('Frequency', parseFloat(e.target.value))} 
                                                />
                                            </div>
                                            <div className="col-md-6">
                                                <label className="form-label">Amplitude (mV)</label>
                                                <input type="number" step="0.001" className="form-control" 
                                                    value={params.SqrWvAmplitude} 
                                                    onChange={(e) => handleParamChange('SqrWvAmplitude', parseFloat(e.target.value))} 
                                                />
                                            </div>
                                            <div className="col-md-6">
                                                <label className="form-label">Ramp Increment (mV)</label>
                                                <input type="number" step="0.001" className="form-control" 
                                                    value={params.SqrWvRampIncrement} 
                                                    onChange={(e) => handleParamChange('SqrWvRampIncrement', parseFloat(e.target.value))} 
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* CV Specific */}
                                    {measType === 'CV' && (
                                        <>
                                            <div className="col-md-6">
                                                <label className="form-label">Step Number</label>
                                                <input type="number" className="form-control" 
                                                    value={params.StepNumber} 
                                                    onChange={(e) => handleParamChange('StepNumber', parseInt(e.target.value))} 
                                                />
                                            </div>
                                            <div className="col-md-6">
                                                <label className="form-label">Ramp Duration (ms)</label>
                                                <input type="number" className="form-control" 
                                                    value={params.RampDuration} 
                                                    onChange={(e) => handleParamChange('RampDuration', parseInt(e.target.value))} 
                                                />
                                            </div>
                                            <div className="col-12">
                                                <div className="form-check">
                                                    <input className="form-check-input" type="checkbox" id="rampOneDir" 
                                                        checked={params.bRampOneDir === 1} 
                                                        onChange={(e) => handleParamChange('bRampOneDir', e.target.checked ? 1 : 0)} 
                                                    />
                                                    <label className="form-check-label" htmlFor="rampOneDir">
                                                        Ramp One Direction Only
                                                    </label>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowMeasureModal(false)}>Cancel</button>
                                <button type="button" className="btn btn-primary" onClick={handleStartMeasurement} disabled={loading}>
                                    Start Measurement
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConnectionManager;