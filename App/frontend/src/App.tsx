import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:4000';

type Parameter = {
  key: string;
  value: string;
};

type CsvData = {
  headers: string[];
  rows: string[][];
};

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
  const [showRawData, setShowRawData] = useState(false);
  const [showVoltageSteps, setShowVoltageSteps] = useState(false);
  const [rawData, setRawData] = useState<CsvData | null>(null);
  const [voltageStepsData, setVoltageStepsData] = useState<CsvData | null>(null);
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState<Tags>({});
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

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

  const handleEntryClick = async (entry: string) => {
    setSelectedEntry(entry);
    setShowRawData(false);
    setShowVoltageSteps(false);
    setRawData(null);
    setVoltageStepsData(null);
    setComment('');

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
    } catch (error) {
      console.error('Error fetching comment:', error);
    }
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

  const handleSaveComment = async () => {
    if (selectedEntry) {
      try {
        await axios.post(`${API_URL}/api/data/${selectedEntry}/comment`, { comment });
        alert('Comment saved!');
      } catch (error) {
        console.error('Error saving comment:', error);
        alert('Failed to save comment.');
      }
    }
  };

  const handleToggleData = async (dataType: 'rawData' | 'voltageSteps') => {
    const shouldShow = dataType === 'rawData' ? !showRawData : !showVoltageSteps;
    const setter = dataType === 'rawData' ? setShowRawData : setShowVoltageSteps;
    const dataSetter = dataType === 'rawData' ? setRawData : setVoltageStepsData;
    const currentData = dataType === 'rawData' ? rawData : voltageStepsData;
    const fileName = dataType === 'rawData' ? 'output_data.csv' : 'voltage_steps.csv';

    setter(shouldShow);

    if (shouldShow && !currentData && selectedEntry) {
      try {
        const response = await axios.get(`${API_URL}/api/data/${selectedEntry}/csv/${fileName}`);
        const lines = response.data.split('\n');
        const headers = lines[0].split(',');
        const rows = lines.slice(1).map((line: string) => line.split(','));
        dataSetter({ headers, rows });
      } catch (error) {
        console.error(`Error fetching ${fileName}:`, error);
      }
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
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
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
        <button className="btn btn-primary mt-2" onClick={handleSaveComment}>Save Comment</button>
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

    const images = ['swv_difference_plot.png', 'output_data.png', 'voltage_steps.png'];

    return (
      <main className="col-md-9 ms-sm-auto col-lg-10 px-md-4">
        <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
          <h1 className="h2">{selectedEntry}</h1>
        </div>

        <div className="row">
          {images.map(image => (
            <div key={image} className="col-md-6 mb-4">
              <div className="card">
                <div className="card-header">{image}</div>
                <div className="card-body">
                  <img src={`${API_URL}/static/${selectedEntry}/${image}`} className="img-fluid plot-image" alt={image} />
                </div>
              </div>
            </div>
          ))}
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
              {renderParametersSidebarCard()}
              {renderFilterSidebar()}
              <div className="card sidebar-card mt-3">
                <div className="card-header">
                  Data Entries
                </div>
                <div className="card-body">
                  <ul className="nav flex-column">
                    {filteredEntries.map(entry => (
                      <li key={entry} className="nav-item d-flex justify-content-between align-items-center">
                        <a
                          className={`nav-link ${selectedEntry === entry ? 'active' : ''}`}
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            handleEntryClick(entry);
                          }}
                        >
                          {entry}
                        </a>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteEntry(entry)}>
                          &times;
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </nav>
          {renderDetailView()}
        </div>
      </div>
    </>
  );
}

export default App;
