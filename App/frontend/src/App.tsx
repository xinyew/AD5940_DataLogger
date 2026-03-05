import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import InteractivePlot from './components/InteractivePlot';
import ConnectionManager from './components/ConnectionManager';

const API_URL = 'http://localhost:4000';

const COLORS = [
  '#1f77b4', // muted blue (default)
  '#ff7f0e', // safety orange
  '#2ca02c', // cooked asparagus green
  '#d62728', // brick red
  '#9467bd', // muted purple
  '#8c564b', // chestnut brown
  '#e377c2', // raspberry yogurt pink
  '#7f7f7f', // middle gray
  '#bcbd22', // curry yellow-green
  '#17becf'  // blue-teal
];

function shadeColor(color: string, percent: number) {
  var f = parseInt(color.slice(1), 16), t = percent < 0 ? 0 : 255, p = percent < 0 ? percent * -1 : percent, R = f >> 16, G = f >> 8 & 0x00FF, B = f & 0x0000FF;
  return "#" + (0x1000000 + (Math.round((t - R) * p) + R) * 0x10000 + (Math.round((t - G) * p) + G) * 0x100 + (Math.round((t - B) * p) + B)).toString(16).slice(1);
}

type Parameter = {
  key: string;
  value: string;
};

type CsvData = {
  headers: string[];
  rows: string[][];
};

type PlotData = {
  x: number[];
  y: number[];
};

type EntryPlotSet = {
  swv: PlotData | null;
  swvOdd: PlotData | null;
  swvEven: PlotData | null;
  raw: PlotData | null;
  voltage: PlotData | null;
}

type Tags = {
  [entryName: string]: {
    auto: string[];
    manual: string[];
  };
};

function App() {
  const [dataEntries, setDataEntries] = useState<string[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);

  // Comparison State
  const [comparedEntries, setComparedEntries] = useState<string[]>([]);
  const [comparisonData, setComparisonData] = useState<{ [entry: string]: EntryPlotSet }>({});

  const [showRawData, setShowRawData] = useState(false);
  const [showVoltageSteps, setShowVoltageSteps] = useState(false);
  const [rawData, setRawData] = useState<CsvData | null>(null);
  const [voltageStepsData, setVoltageStepsData] = useState<CsvData | null>(null);
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState<Tags>({});
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [saveStatus, setSaveStatus] = useState<string>('');
  const lastSavedComment = useRef<string | null>(null);

  // Plot Visibility States (Persistent across entries)
  const [showPlotSWV, setShowPlotSWV] = useState(true);
  const [showPlotRaw, setShowPlotRaw] = useState(false);
  const [showPlotVSteps, setShowPlotVSteps] = useState(false);

  // SWV Sub-line Visibility
  const [swvVisibility, setSwvVisibility] = useState({ diff: true, odd: false, even: false });

  // Primary Plot Data States (for selectedEntry)
  const [swvPlotData, setSwvPlotData] = useState<PlotData | null>(null);
  const [swvOddData, setSwvOddData] = useState<PlotData | null>(null);
  const [swvEvenData, setSwvEvenData] = useState<PlotData | null>(null);
  const [rawPlotData, setRawPlotData] = useState<PlotData | null>(null);
  const [voltagePlotData, setVoltagePlotData] = useState<PlotData | null>(null);

  // Plot Layout States (Persist Zoom/Pan)
  const [swvLayout, setSwvLayout] = useState({});
  const [rawLayout, setRawLayout] = useState({});
  const [vStepsLayout, setVStepsLayout] = useState({});

  // Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState('PalmSens4');

  // Helper: Fetch Plot Data for ANY entry
  const getPlotDataForEntry = async (entry: string): Promise<EntryPlotSet> => {
    const result: EntryPlotSet = { swv: null, swvOdd: null, swvEven: null, raw: null, voltage: null };

    try {
      // 1. Fetch Parameters (needed for SWV calc)
      const paramsRes = await axios.get(`${API_URL}/api/data/${entry}/parameters`);
      const params = paramsRes.data.split('\n').map((line: string) => {
        const [key, ...valueParts] = line.split(':');
        return { key: key.trim().replace('Param_', ''), value: valueParts.join(':').trim() };
      });

      // 2. Fetch Raw Output
      const outputRes = await axios.get(`${API_URL}/api/data/${entry}/csv/output_data.csv?t=${Date.now()}`);
      const outputLines = outputRes.data.trim().split('\n');
      const outputRows = outputLines.slice(1).map((line: string) => line.split(',').map(Number));
      const rawX = outputRows.map((row: number[]) => row[0]);
      const rawY = outputRows.map((row: number[]) => row[1]);

      // Shift X-axis to start at 0
      const minX = rawX.length > 0 ? rawX[0] : 0;
      const shiftedX = rawX.map((x: number) => x - minX);

      result.raw = { x: shiftedX, y: rawY };

      // 3. Calculate SWV
      const startVoltParam = params.find((p: any) => p.key === 'RampStartVolt')?.value;
      const endVoltParam = params.find((p: any) => p.key === 'RampPeakVolt')?.value;

      if (startVoltParam && endVoltParam && rawY.length > 0) {
        const startVolt = parseFloat(startVoltParam);
        const endVolt = parseFloat(endVoltParam);
        let cleanValues = [...rawY];
        if (cleanValues.length % 2 !== 0) cleanValues.shift();

        const differences: number[] = [];
        const odds: number[] = [];
        const evens: number[] = [];

        for (let i = 0; i < cleanValues.length; i += 2) {
          const evenVal = cleanValues[i];
          const oddVal = cleanValues[i + 1];
          differences.push(oddVal - evenVal);
          evens.push(evenVal);
          odds.push(oddVal);
        }
        const numPoints = differences.length;
        const swvX: number[] = [];
        if (numPoints > 0) {
          const scaleFactor = endVolt - startVolt;
          for (let i = 0; i < numPoints; i++) {
            swvX.push(startVolt + (i * scaleFactor / numPoints));
          }
        }
        result.swv = { x: swvX, y: differences };
        result.swvOdd = { x: swvX, y: odds };
        result.swvEven = { x: swvX, y: evens };
      }

      // 4. Fetch Voltage Steps
      const voltRes = await axios.get(`${API_URL}/api/data/${entry}/csv/voltage_steps.csv?t=${Date.now()}`);
      const voltLines = voltRes.data.trim().split('\n');
      const voltValues = voltLines.slice(1).map((line: string) => parseFloat(line.trim()));
      const voltX = voltValues.map((_: number, idx: number) => idx);
      result.voltage = { x: voltX, y: voltValues };

    } catch (e) {
      console.error(`Failed to fetch plot data for ${entry}`, e);
    }
    return result;
  };

  // Effect: Fetch data for compared entries
  useEffect(() => {
    const loadComparisonData = async () => {
      const newData = { ...comparisonData };
      let changed = false;
      for (const entry of comparedEntries) {
        if (!newData[entry]) {
          newData[entry] = await getPlotDataForEntry(entry);
          changed = true;
        }
      }
      const currentKeys = Object.keys(newData);
      for (const key of currentKeys) {
        if (!comparedEntries.includes(key)) {
          // delete newData[key]; // Optional: clear cache
          // changed = true;
        }
      }

      if (changed) setComparisonData(newData);
    };

    if (comparedEntries.length > 0) loadComparisonData();
  }, [comparedEntries]);

  // Toggle Compare
  const toggleCompare = (entry: string) => {
    setComparedEntries(prev => {
      if (prev.includes(entry)) return prev.filter(e => e !== entry);
      return [...prev, entry];
    });
  };

  const handleFlipData = async (entry: string) => {
    if (!window.confirm(`Are you sure you want to flip the data values for ${entry}? This will permanently modify the CSV file.`)) {
      return;
    }
    try {
      await axios.post(`${API_URL}/api/data/${entry}/flip`);
      // Reload data for this entry
      if (entry === selectedEntry) {
        // Reload current
        fetchAndProcessPlotData(entry, parameters);
      }
      // If it's in comparison data, reload it there too
      if (comparedEntries.includes(entry)) {
        const newData = await getPlotDataForEntry(entry);
        setComparisonData(prev => ({ ...prev, [entry]: newData }));
      }
    } catch (error) {
      console.error('Error flipping data:', error);
      alert('Failed to flip data.');
    }
  };

  // Fetch all data and set up polling
  useEffect(() => {
    const fetchAllData = async () => {
      try {
        const entriesRes = await axios.get(`${API_URL}/api/data`);
        const newEntries = entriesRes.data;
        setDataEntries(newEntries);

        const tagsRes = await axios.get(`${API_URL}/api/tags`);
        const currentTags = tagsRes.data;

        // Auto-generate tags for new entries
        let updatedTags = { ...currentTags };
        let tagsNeedSave = false;
        for (const entry of newEntries) {
          if (!updatedTags[entry]) {
            try {
              const paramsResponse = await axios.get(`${API_URL}/api/data/${entry}/parameters`);
              const parsedParams = paramsResponse.data.split('\n').map((line: string) => {
                const [key, ...valueParts] = line.split(':');
                return { key: key.trim(), value: valueParts.join(':').trim() };
              }).filter((param: Parameter) => param.key && param.value);

              const autoTags: string[] = [];
              const deviceName = parsedParams.find((p: Parameter) => p.key === 'Device Name')?.value;
              if (deviceName) autoTags.push(deviceName);
              const freq = parsedParams.find((p: Parameter) => p.key === 'Param_Frequency')?.value;
              if (freq) autoTags.push(`frequency_${freq}`);
              const sampleDelay = parsedParams.find((p: Parameter) => p.key === 'Param_SampleDelay')?.value;
              if (sampleDelay) autoTags.push(`sampledelay_${sampleDelay}`);
              const rtia = parsedParams.find((p: Parameter) => p.key === 'Param_LPTIARtiaVal')?.value;
              if (rtia) autoTags.push(`LPTIARtia_${rtia}`);

              updatedTags[entry] = { auto: autoTags, manual: [] };
              tagsNeedSave = true;
            } catch (paramError) {
              console.error(`Failed to fetch params for new entry ${entry}:`, paramError);
            }
          }
        }

        if (tagsNeedSave) {
          handleSaveTags(updatedTags);
        } else {
          setTags(currentTags);
        }

      } catch (error) {
        console.error('Error fetching initial data:', error);
      }
    };

    fetchAllData();
    const interval = setInterval(fetchAllData, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Auto-select first entry
  useEffect(() => {
    if (dataEntries.length > 0 && !selectedEntry) {
      handleEntryClick(dataEntries[0]);
    }
  }, [dataEntries, selectedEntry]);

  // Auto-save comment effect
  useEffect(() => {
    if (!selectedEntry || lastSavedComment.current === null || comment === lastSavedComment.current) {
      return;
    }

    setSaveStatus('Saving...');
    const timer = setTimeout(async () => {
      try {
        await axios.post(`${API_URL}/api/data/${selectedEntry}/comment`, { comment });
        setSaveStatus('Saved');
        lastSavedComment.current = comment;
      } catch (error) {
        console.error('Error saving comment:', error);
        setSaveStatus('Error saving');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [comment, selectedEntry]);

  const handleEntryClick = async (entry: string) => {
    setSelectedEntry(entry);
    setComment('');
    setSaveStatus('');
    lastSavedComment.current = null; // Reset ref so we don't auto-save immediately

    let currentParams: Parameter[] = [];

    // Fetch parameters and generate auto tags
    try {
      const paramsResponse = await axios.get(`${API_URL}/api/data/${entry}/parameters`);
      const parsedParams = paramsResponse.data.split('\n').map((line: string) => {
        const [key, ...valueParts] = line.split(':');
        const formattedKey = key.trim().replace('Param_', '');
        let formattedValue = valueParts.join(':').trim();
        if (formattedKey && formattedValue) {
          const numericValue = parseFloat(formattedValue);
          if (!isNaN(numericValue)) {
            formattedValue = numericValue.toFixed(3);
          }
        }
        return { key: formattedKey, value: formattedValue };
      }).filter((param: Parameter) => param.key && param.value);

      currentParams = parsedParams;
      setParameters(parsedParams);
      generateAutoTags(entry, parsedParams);
    } catch (error) {
      console.error('Error fetching parameters:', error);
      setParameters([]);
    }

    // Fetch comment
    try {
      const commentResponse = await axios.get(`${API_URL}/api/data/${entry}/comment`);
      setComment(commentResponse.data.comment);
      lastSavedComment.current = commentResponse.data.comment;
    } catch (error) {
      console.error('Error fetching comment:', error);
      lastSavedComment.current = ''; // Assume empty if fail
    }

    // Fetch and process data for plots
    fetchAndProcessPlotData(entry, currentParams);

    // Refresh tables if visible
    if (showRawData) {
      const data = await fetchTableData(entry, 'output_data.csv');
      setRawData(data);
    }
    if (showVoltageSteps) {
      const data = await fetchTableData(entry, 'voltage_steps.csv');
      setVoltageStepsData(data);
    }
  };

  const fetchAndProcessPlotData = async (entry: string, _params: Parameter[]) => {
    const data = await getPlotDataForEntry(entry);
    setRawPlotData(data.raw);
    setSwvPlotData(data.swv);
    setSwvOddData(data.swvOdd);
    setSwvEvenData(data.swvEven);
    setVoltagePlotData(data.voltage);
  };

  const generateAutoTags = (entry: string, params: Parameter[]) => {
    const autoTags: string[] = [];
    const deviceName = params.find(p => p.key === 'Device Name')?.value;
    if (deviceName) autoTags.push(deviceName);

    const freq = params.find(p => p.key === 'Frequency')?.value;
    if (freq) autoTags.push(`frequency_${freq}`);

    const sampleDelay = params.find(p => p.key === 'SampleDelay')?.value;
    if (sampleDelay) autoTags.push(`sampledelay_${sampleDelay}`);

    const rtia = params.find(p => p.key === 'LPTIARtiaVal')?.value;
    if (rtia) autoTags.push(`LPTIARtia_${rtia}`);

    setTags(prevTags => ({
      ...prevTags,
      [entry]: {
        ...prevTags[entry],
        auto: autoTags,
        manual: prevTags[entry]?.manual || [],
      },
    }));
  };

  const handleSaveTags = async (updatedTags: Tags) => {
    try {
      await axios.post(`${API_URL}/api/tags`, { tags: updatedTags });
      setTags(updatedTags);
    } catch (error) {
      console.error('Error saving tags:', error);
    }
  };

  const handleAddTag = () => {
    if (newTag && selectedEntry && !tags[selectedEntry]?.manual.includes(newTag)) {
      const updatedTags = { ...tags };
      updatedTags[selectedEntry].manual.push(newTag);
      handleSaveTags(updatedTags);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (selectedEntry) {
      const updatedTags = { ...tags };
      updatedTags[selectedEntry].manual = updatedTags[selectedEntry].manual.filter(t => t !== tagToRemove);
      handleSaveTags(updatedTags);
    }
  };

  const handleDeleteEntry = async (entryToDelete: string) => {
    if (window.confirm(`Are you sure you want to delete ${entryToDelete}? This action cannot be undone.`)) {
      try {
        await axios.delete(`${API_URL}/api/data/${entryToDelete}`);

        // Update state
        const newEntries = dataEntries.filter(entry => entry !== entryToDelete);
        setDataEntries(newEntries);

        const newTags = { ...tags };
        delete newTags[entryToDelete];
        setTags(newTags);

        if (selectedEntry === entryToDelete) {
          setSelectedEntry(null);
        }

      } catch (error) {
        console.error('Error deleting entry:', error);
        alert('Failed to delete entry.');
      }
    }
  };

  const fetchTableData = async (entry: string, fileName: string): Promise<CsvData | null> => {
    try {
      const response = await axios.get(`${API_URL}/api/data/${entry}/csv/${fileName}`);
      const lines = response.data.trim().split('\n');
      const headers = lines[0].split(',');
      const rows = lines.slice(1).map((line: string) => line.split(','));
      return { headers, rows };
    } catch (error) {
      console.error(`Error fetching ${fileName}:`, error);
      return null;
    }
  };

  const handleToggleData = async (dataType: 'rawData' | 'voltageSteps') => {
    const shouldShow = dataType === 'rawData' ? !showRawData : !showVoltageSteps;
    const setter = dataType === 'rawData' ? setShowRawData : setShowVoltageSteps;
    const dataSetter = dataType === 'rawData' ? setRawData : setVoltageStepsData;
    const fileName = dataType === 'rawData' ? 'output_data.csv' : 'voltage_steps.csv';

    setter(shouldShow);

    if (shouldShow && selectedEntry) {
      const data = await fetchTableData(selectedEntry, fileName);
      dataSetter(data);
    }
  };

  const formatDataCell = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return value;

    // Check if it's likely an index (integer)
    // If it parses to an integer (e.g. 1.255e+03 -> 1255), return it as a simple string "1255"
    if (Number.isInteger(num)) return num.toString();

    // Use toFixed to avoid scientific notation for small numbers, remove trailing zeros
    // But ensure at least one decimal digit if it was a float
    let formatted = num.toFixed(10).replace(/\.?0+$/, "");

    return formatted;
  };

  const handleImportData = async () => {
    try {
      if (importFormat === 'PalmSens4') {
        const lines = importText.trim().split('\n');
        // Find header row containing potential and currents
        const headerIndex = lines.findIndex(l => l.includes('potential/V') && l.includes('Reverse/') && l.includes('Forward/'));

        if (headerIndex === -1) {
          alert("Invalid PalmSens4 format: Could not find header row with 'potential/V', 'Reverse', and 'Forward'.");
          return;
        }

        const headerLine = lines[headerIndex];
        const sep = headerLine.includes('\t') ? '\t' : ',';
        const headers = headerLine.split(sep).map(h => h.trim());

        const voltIndex = headers.indexOf('potential/V');
        // Use findIndex with startsWith to handle special characters like µA
        const revIndex = headers.findIndex(h => h.startsWith('Reverse/'));
        const fwdIndex = headers.findIndex(h => h.startsWith('Forward/'));

        if (voltIndex === -1 || revIndex === -1 || fwdIndex === -1) {
          alert("Invalid PalmSens4 format: Missing required columns.");
          return;
        }

        const interleavedCurrents: number[] = [];
        const rawPotentials: number[] = [];

        for (let i = headerIndex + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split(sep);

          if (parts.length > Math.max(voltIndex, revIndex, fwdIndex)) {
            const vVal = parseFloat(parts[voltIndex]); // Volts
            const rVal = parseFloat(parts[revIndex]);  // Reverse (Even)
            const fVal = parseFloat(parts[fwdIndex]);  // Forward (Odd)

            if (!isNaN(vVal) && !isNaN(rVal) && !isNaN(fVal)) {
              rawPotentials.push(vVal * 1000); // Store as mV
              // User requested: 0th Reverse -> 0th Forward -> 1st Reverse -> 1st Forward ...
              interleavedCurrents.push(rVal); // Even
              interleavedCurrents.push(fVal); // Odd
            }
          }
        }

        if (interleavedCurrents.length === 0) {
          alert("No valid data points found.");
          return;
        }

        // Set params for the SWV plot calculation logic
        const startVolt = rawPotentials[0];
        const peakVolt = rawPotentials[rawPotentials.length - 1];

        // Send to backend
        const response = await axios.post(`${API_URL}/api/import`, {
          deviceName: 'PalmSens4',
          voltages: [], // User requested blank voltage steps
          currents: interleavedCurrents,
          params: {
            Param_RampStartVolt: startVolt,
            Param_RampPeakVolt: peakVolt
          }
        });

        if (response.data.success) {
          alert("Import successful!");
          setShowImportModal(false);
          setImportText('');
        }
      } else if (importFormat === 'xylem') {
        const lines = importText.trim().split('\n');
        // Find header row containing specific words, ignoring any leading/trailing spaces
        const headerIndex = lines.findIndex(l => {
          const trimmedLine = l.trim();
          return trimmedLine.includes('Voltage (mV)') &&
            trimmedLine.includes('Forward Current') &&
            trimmedLine.includes('Reverse Current');
        });

        if (headerIndex === -1) {
          alert("Invalid xylem format: Could not find header row with 'Voltage (mV)', 'Forward Current', and 'Reverse Current'.");
          return;
        }

        const headerLine = lines[headerIndex];
        const sep = headerLine.includes('\t') ? '\t' : ',';
        const headers = headerLine.split(sep).map(h => h.trim());

        const voltIndex = headers.findIndex(h => h.includes('Voltage (mV)'));
        const fwdIndex = headers.findIndex(h => h.includes('Forward Current'));
        const revIndex = headers.findIndex(h => h.includes('Reverse Current'));

        if (voltIndex === -1 || revIndex === -1 || fwdIndex === -1) {
          alert("Invalid xylem format: Missing required columns.");
          return;
        }

        const interleavedCurrents: number[] = [];
        const rawPotentials: number[] = [];

        for (let i = headerIndex + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.split(sep);

          if (parts.length > Math.max(voltIndex, revIndex, fwdIndex)) {
            const vVal = parseFloat(parts[voltIndex]); // mV
            const fVal = parseFloat(parts[fwdIndex]);  // nA
            const rVal = parseFloat(parts[revIndex]);  // nA

            if (!isNaN(vVal) && !isNaN(rVal) && !isNaN(fVal)) {
              rawPotentials.push(vVal); // Already in mV
              // User requested: 0th Reverse -> 0th Forward -> 1st Reverse -> 1st Forward ...
              // And we convert nA to uA to match plotting label Current (uA)
              interleavedCurrents.push(rVal / 1000); // Even (Reverse)
              interleavedCurrents.push(fVal / 1000); // Odd (Forward)
            }
          }
        }

        if (interleavedCurrents.length === 0) {
          alert("No valid data points found.");
          return;
        }

        // Set params for the SWV plot calculation logic
        const startVolt = rawPotentials[0];
        const peakVolt = rawPotentials[rawPotentials.length - 1];

        // Send to backend
        const response = await axios.post(`${API_URL}/api/import`, {
          deviceName: 'xylem',
          voltages: [], // blank voltage steps
          currents: interleavedCurrents,
          params: {
            Param_RampStartVolt: startVolt,
            Param_RampPeakVolt: peakVolt
          }
        });

        if (response.data.success) {
          alert("Import successful!");
          setShowImportModal(false);
          setImportText('');
        }
      }
    } catch (error: any) {
      console.error("Import failed:", error);
      alert(`Import failed: ${error.message}`);
    }
  };

  // --- RENDER FUNCTIONS ---

  const renderDataTable = (data: CsvData | null, title: string) => {
    if (!data) return null;
    return (
      <div className="card mt-4">
        <div className="card-header">{title}</div>
        <div className="card-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table className="table table-sm table-striped">
            <thead>
              <tr>
                {data.headers.map(header => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{formatDataCell(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderCommentBox = () => (
    <div className="card mt-4">
      <div className="card-header">Comments</div>
      <div className="card-body">
        <textarea
          className="form-control"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        ></textarea>
        <div className="mt-2">
          <small className={`text-muted ${saveStatus === 'Error saving' ? 'text-danger' : saveStatus === 'Saved' ? 'text-success' : ''}`}>
            {saveStatus}
          </small>
        </div>
      </div>
    </div>
  );

  const renderTags = () => {
    if (!selectedEntry) return null;
    const entryTags = tags[selectedEntry] || { auto: [], manual: [] };
    return (
      <div className="card mt-4">
        <div className="card-header">Tags</div>
        <div className="card-body">
          <div>
            {entryTags.auto.map(tag => <span key={tag} className="badge bg-secondary me-1">{tag}</span>)}
            {entryTags.manual.map(tag => (
              <span key={tag} className="badge bg-info me-1">
                {tag} <button type="button" className="btn-close btn-close-white ms-1" onClick={() => handleRemoveTag(tag)}></button>
              </span>
            ))}
          </div>
          <div className="input-group mt-3">
            <input type="text" className="form-control" placeholder="New tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
            <button className="btn btn-outline-secondary" type="button" onClick={handleAddTag}>Add</button>
          </div>
        </div>
      </div>
    );
  };

  const renderParametersSidebarCard = () => (
    <div className="card sidebar-card">
      <div className="card-header">
        Parameters
      </div>
      <div className="card-body">
        <ul className="list-group list-group-flush">
          {parameters.map(param => (
            <li key={param.key} className="list-group-item d-flex justify-content-between align-items-center">
              {param.key}
              <span className="badge bg-primary rounded-pill">{param.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  const renderFilterSidebar = () => {
    const allTags = [...new Set(Object.values(tags).flatMap(t => [...t.auto, ...t.manual]))];
    return (
      <div className="card sidebar-card mt-3">
        <div className="card-header">Filter by Tags</div>
        <div className="card-body">
          {allTags.map(tag => (
            <div key={tag} className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                value={tag}
                id={`filter-${tag}`}
                checked={filterTags.includes(tag)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setFilterTags([...filterTags, tag]);
                  } else {
                    setFilterTags(filterTags.filter(t => t !== tag));
                  }
                }}
              />
              <label className="form-check-label" htmlFor={`filter-${tag}`}>{tag}</label>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const getTraces = (type: 'swv' | 'raw' | 'voltage') => {
    const traces: any[] = [];

    let baseData: PlotData | null = null;
    let title = selectedEntry || 'Current';

    if (type === 'swv') {
      if (swvVisibility.diff && swvPlotData) {
        traces.push({
          x: swvPlotData.x,
          y: swvPlotData.y,
          type: 'scatter',
          mode: 'lines+markers',
          name: `${title} (Diff)`,
          line: { color: COLORS[0] }
        });
      }
      if (swvVisibility.odd && swvOddData) {
        traces.push({
          x: swvOddData.x,
          y: swvOddData.y,
          type: 'scatter',
          mode: 'lines',
          name: `${title} (Odd)`,
          line: { color: shadeColor(COLORS[0], 0.4), width: 1 }
        });
      }
      if (swvVisibility.even && swvEvenData) {
        traces.push({
          x: swvEvenData.x,
          y: swvEvenData.y,
          type: 'scatter',
          mode: 'lines',
          name: `${title} (Even)`,
          line: { color: shadeColor(COLORS[0], -0.4), width: 1 }
        });
      }
    } else {
      // ... Raw/Voltage logic ...
      if (type === 'raw') baseData = rawPlotData;
      else if (type === 'voltage') baseData = voltagePlotData;

      if (baseData) {
        traces.push({
          x: baseData.x,
          y: baseData.y,
          type: 'scatter',
          mode: 'lines',
          name: title,
          line: { color: COLORS[0], shape: type === 'voltage' ? 'hv' : undefined }
        });
      }
    }

    // Comparison Traces
    comparedEntries.forEach((entry, idx) => {
      if (entry === selectedEntry) return;
      const entryData = comparisonData[entry];
      if (!entryData) return;

      const color = COLORS[(idx + 1) % COLORS.length];

      if (type === 'swv') {
        if (entryData.swv && swvVisibility.diff) {
          traces.push({
            x: entryData.swv.x,
            y: entryData.swv.y,
            type: 'scatter',
            mode: 'lines+markers',
            name: `${entry} (Diff)`,
            line: { color: color }
          });
        }
        if (entryData.swvOdd && swvVisibility.odd) {
          traces.push({
            x: entryData.swvOdd.x,
            y: entryData.swvOdd.y,
            type: 'scatter',
            mode: 'lines',
            name: `${entry} (Odd)`,
            line: { color: shadeColor(color, 0.4), width: 1 }
          });
        }
        if (entryData.swvEven && swvVisibility.even) {
          traces.push({
            x: entryData.swvEven.x,
            y: entryData.swvEven.y,
            type: 'scatter',
            mode: 'lines',
            name: `${entry} (Even)`,
            line: { color: shadeColor(color, -0.4), width: 1 }
          });
        }
      } else {
        let data: PlotData | null = null;
        if (type === 'raw') data = entryData.raw;
        else if (type === 'voltage') data = entryData.voltage;

        if (data) {
          traces.push({
            x: data.x,
            y: data.y,
            type: 'scatter',
            mode: 'lines',
            name: entry,
            line: { color: color, shape: type === 'voltage' ? 'hv' : undefined }
          });
        }
      }
    });

    return traces;
  };

  const renderDetailView = () => {
    if (!selectedEntry) {
      return (
        <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
          <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
            <h1 className="h2">Dashboard</h1>
          </div>
          <p>Select an entry to view details.</p>
        </main>
      );
    }

    return (
      <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
        <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
          <h1 className="h2">{selectedEntry}</h1>
          <div className="btn-group me-2">
            <button
              type="button"
              className={`btn btn-sm btn-outline-secondary ${showPlotSWV ? 'active' : ''}`}
              onClick={() => setShowPlotSWV(!showPlotSWV)}
            >
              SWV
            </button>
            <button
              type="button"
              className={`btn btn-sm btn-outline-secondary ${showPlotRaw ? 'active' : ''}`}
              onClick={() => setShowPlotRaw(!showPlotRaw)}
            >
              Raw
            </button>
            <button
              type="button"
              className={`btn btn-sm btn-outline-secondary ${showPlotVSteps ? 'active' : ''}`}
              onClick={() => setShowPlotVSteps(!showPlotVSteps)}
            >
              VSteps
            </button>
          </div>
        </div>

        <div className="row">
          {/* SWV Plot */}
          {showPlotSWV && (
            <div className="col-12 mb-4">
              <div className="card">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <span>SWV Difference Plot</span>
                  <div className="btn-group btn-group-sm">
                    <div className="form-check form-check-inline m-0 me-2">
                      <input className="form-check-input" type="checkbox" id="checkDiff"
                        checked={swvVisibility.diff}
                        onChange={(e) => setSwvVisibility(prev => ({ ...prev, diff: e.target.checked }))} />
                      <label className="form-check-label" htmlFor="checkDiff">Diff</label>
                    </div>
                    <div className="form-check form-check-inline m-0 me-2">
                      <input className="form-check-input" type="checkbox" id="checkOdd"
                        checked={swvVisibility.odd}
                        onChange={(e) => setSwvVisibility(prev => ({ ...prev, odd: e.target.checked }))} />
                      <label className="form-check-label" htmlFor="checkOdd">Odd</label>
                    </div>
                    <div className="form-check form-check-inline m-0">
                      <input className="form-check-input" type="checkbox" id="checkEven"
                        checked={swvVisibility.even}
                        onChange={(e) => setSwvVisibility(prev => ({ ...prev, even: e.target.checked }))} />
                      <label className="form-check-label" htmlFor="checkEven">Even</label>
                    </div>
                  </div>
                  <div className="border-start ps-2 ms-2">
                    <button
                      className="btn btn-sm btn-outline-warning"
                      onClick={() => selectedEntry && handleFlipData(selectedEntry)}
                      title="Permanently swap Odd/Even values in CSV"
                    >
                      Flip Data
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  {/* Check if ANY data is available to display */}
                  {(swvPlotData || (comparedEntries.length > 0)) ? (
                    <InteractivePlot
                      data={getTraces('swv')}
                      title="SWV Plot"
                      xLabel="Voltage (mV)"
                      yLabel="Current (uA)"
                      height={900}
                      layout={swvLayout}
                      onRelayout={(e) => setSwvLayout(prev => ({ ...prev, ...e }))}
                    />
                  ) : (
                    <p>Loading or no data available for SWV plot...</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Raw Output Plot */}
          {showPlotRaw && (
            <div className="col-12 mb-4">
              <div className="card">
                <div className="card-header">Output Data (Raw)</div>
                <div className="card-body">
                  {rawPlotData ? (
                    <InteractivePlot
                      data={getTraces('raw')}
                      title="Output Data"
                      xLabel="Index"
                      yLabel="Value"
                      height={900}
                      layout={rawLayout}
                      onRelayout={(e) => setRawLayout(prev => ({ ...prev, ...e }))}
                    />
                  ) : (
                    <p>Loading Raw Data...</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Voltage Steps Plot */}
          {showPlotVSteps && (
            <div className="col-12 mb-4">
              <div className="card">
                <div className="card-header">Voltage Steps</div>
                <div className="card-body">
                  {voltagePlotData ? (
                    <InteractivePlot
                      data={getTraces('voltage')}
                      title="Voltage Steps"
                      xLabel="Step"
                      yLabel="Voltage (mV)"
                      height={900}
                      layout={vStepsLayout}
                      onRelayout={(e) => setVStepsLayout(prev => ({ ...prev, ...e }))}
                    />
                  ) : (
                    <p>Loading Voltage Steps...</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {renderTags()}
        {renderCommentBox()}

        <div className="mt-4">
          <button className="btn btn-secondary me-2" onClick={() => handleToggleData('rawData')}>
            {showRawData ? 'Hide' : 'Show'} Raw Data
          </button>
          <button className="btn btn-secondary" onClick={() => handleToggleData('voltageSteps')}>
            {showVoltageSteps ? 'Hide' : 'Show'} Voltage Steps
          </button>
        </div>

        {showRawData && renderDataTable(rawData, 'Raw Output Data')}
        {showVoltageSteps && renderDataTable(voltageStepsData, 'Voltage Steps')}
      </main>
    );
  };

  const filteredEntries = dataEntries.filter(entry => {
    if (filterTags.length === 0) return true;
    const entryTags = tags[entry] ? [...tags[entry].auto, ...tags[entry].manual] : [];
    return filterTags.every(filterTag => entryTags.includes(filterTag));
  });

  return (
    <>
      <header className="navbar navbar-dark sticky-top bg-dark flex-md-nowrap p-0 shadow">
        <a className="navbar-brand col-md-3 col-lg-2 me-0 px-3" href="#">AD5940 Data Logger</a>
      </header>

      <div className="container-fluid">
        <div className="row">
          <nav id="sidebarMenu" className="col-md-3 col-lg-2 d-md-block bg-light sidebar collapse">
            <div className="position-sticky pt-3 sidebar-content">
              <ConnectionManager />
              {renderParametersSidebarCard()}
              {renderFilterSidebar()}
              <div className="card sidebar-card mt-3">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <span>Data Entries</span>
                  <button className="btn btn-sm btn-outline-primary" onClick={() => setShowImportModal(true)} title="Import Data">
                    Add
                  </button>
                </div>
                <div className="card-body">
                  <ul className="nav flex-column">
                    {filteredEntries.map(entry => {
                      const isSelected = entry === selectedEntry;
                      const isCompared = comparedEntries.includes(entry);
                      const compareIndex = comparedEntries.indexOf(entry);
                      // Selected is index 0 color (Blue). Comparisons start at index 1 color.
                      // We use index+1 for comparison colors to avoid clashing with selected blue.
                      const compareColor = isSelected
                        ? COLORS[0]
                        : (isCompared ? COLORS[(compareIndex + 1) % COLORS.length] : undefined);

                      return (
                        <li key={entry} className="nav-item d-flex justify-content-between align-items-center">
                          <a
                            className={`nav-link flex-grow-1 ${isSelected ? 'active' : ''}`}
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              handleEntryClick(entry);
                            }}
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}
                            title={entry}
                          >
                            {entry}
                          </a>
                          <div className="btn-group btn-group-sm flex-shrink-0">
                            <button
                              className={`btn ${isSelected || isCompared ? '' : 'btn-outline-secondary'}`}
                              style={isSelected || isCompared ? { backgroundColor: compareColor, borderColor: compareColor, color: 'white' } : {}}
                              onClick={() => isSelected ? null : toggleCompare(entry)}
                              title={isSelected ? "Current Entry (Base)" : (isCompared ? "Remove from comparison" : "Add to comparison")}
                            >
                              {isSelected || isCompared ? '☑' : '☐'}
                            </button>
                            <button className="btn btn-outline-danger" onClick={() => handleDeleteEntry(entry)}>
                              &times;
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          </nav>
          {renderDetailView()}
        </div>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Import Data</h5>
                <button type="button" className="btn-close" onClick={() => setShowImportModal(false)}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Data Format</label>
                  <select className="form-select" value={importFormat} onChange={(e) => setImportFormat(e.target.value)}>
                    <option value="PalmSens4">PalmSens4</option>
                    <option value="xylem">xylem</option>
                  </select>
                </div>
                <div className="mb-3">
                  <label className="form-label">Paste Data (CSV/Text)</label>
                  <textarea
                    className="form-control"
                    rows={10}
                    value={importText}
                    onChange={(e) => {
                      const text = e.target.value;
                      setImportText(text);
                      const topLines = text.split('\n').slice(0, 5).join(' ');
                      if (topLines.includes('Voltage (mV)') && topLines.includes('Forward Current')) {
                        setImportFormat('xylem');
                      } else if (topLines.includes('potential/V') && topLines.includes('Reverse/')) {
                        setImportFormat('PalmSens4');
                      }
                    }}
                    placeholder="Paste data here..."
                    style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                  ></textarea>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleImportData} disabled={!importText.trim()}>
                  Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;