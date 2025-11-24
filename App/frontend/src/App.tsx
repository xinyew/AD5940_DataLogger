import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:4000';

function App() {
  const [dataEntries, setDataEntries] = useState<string[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [parameters, setParameters] = useState<string | null>(null);

  useEffect(() => {
    const fetchDataEntries = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/data`);
        setDataEntries(response.data);
      } catch (error) {
        console.error('Error fetching data entries:', error);
      }
    };

    fetchDataEntries();
    const interval = setInterval(fetchDataEntries, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const handleEntryClick = async (entry: string) => {
    setSelectedEntry(entry);
    try {
      const response = await axios.get(`${API_URL}/api/data/${entry}/parameters`);
      setParameters(response.data);
    } catch (error) {
      console.error('Error fetching parameters:', error);
      setParameters('Could not load parameters.');
    }
  };

  const renderDetailView = () => {
    if (!selectedEntry) {
      return <div className="col-md-8"><p>Select an entry to view details.</p></div>;
    }

    const images = ['output_data.png', 'swv_difference_plot.png', 'voltage_steps.png'];

    return (
      <div className="col-md-8">
        <h2>{selectedEntry}</h2>
        <h3>Parameters</h3>
        <pre>{parameters}</pre>
        <h3>Plots</h3>
        {images.map(image => (
          <div key={image} className="mb-3">
            <h5>{image}</h5>
            <img src={`${API_URL}/static/${selectedEntry}/${image}`} className="img-fluid" alt={image} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="container-fluid mt-3">
      <div className="row">
        <div className="col-md-4">
          <h2>Data Entries</h2>
          <ul className="list-group">
            {dataEntries.map(entry => (
              <li
                key={entry}
                className={`list-group-item ${selectedEntry === entry ? 'active' : ''}`}
                onClick={() => handleEntryClick(entry)}
                style={{ cursor: 'pointer' }}
              >
                {entry}
              </li>
            ))}
          </ul>
        </div>
        {renderDetailView()}
      </div>
    </div>
  );
}

export default App;
