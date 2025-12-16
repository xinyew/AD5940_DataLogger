import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:4000';

interface ConnectionManagerProps {}

const ConnectionManager: React.FC<ConnectionManagerProps> = () => {
    const [devices, setDevices] = useState<string[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string>('');
    const [status, setStatus] = useState<{ connected: boolean, deviceName: string | null }>({ connected: false, deviceName: null });
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
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
            // If user is within 20px of the bottom, enable auto-scroll
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
            fetchLogs(); // Fetch immediately
            interval = setInterval(fetchLogs, 1000);
        } else {
            setLogs([]); // Clear logs when disconnected
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
        setShowModal(true);
    };

    const handleConnectSubmit = async () => {
        if (!selectedDevice) return;
        try {
            setLoading(true);
            await axios.post(`${API_URL}/api/connect`, { deviceName: selectedDevice });
            setShowModal(false);
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

    const handleReadClick = async () => {
        if (isReadingRef.current) return;
        isReadingRef.current = true;
        try {
            setLoading(true);
            await axios.post(`${API_URL}/api/trigger`);
            // Alert removed
        } catch (error: any) {
            console.error("Failed to trigger read", error);
            alert(`Failed to trigger read: ${error.message}`);
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
                                Disconnect {status.deviceName}
                            </button>
                            <button className="btn btn-primary" onClick={handleReadClick} disabled={loading}>
                                Read
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

            {/* Modal for Device Selection */}
            {showModal && (
                <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">Select BLE Device</h5>
                                <button type="button" className="btn-close" onClick={() => setShowModal(false)}></button>
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
                                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="button" className="btn btn-primary" onClick={handleConnectSubmit} disabled={!selectedDevice || loading}>
                                    Connect
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
