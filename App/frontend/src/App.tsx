import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:4000';

type Parameter = {
  key: string;
  value: string;
};

function App() {
  const [dataEntries, setDataEntries] = useState<string[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);

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

  useEffect(() => {
    if (dataEntries.length > 0 && !selectedEntry) {
      handleEntryClick(dataEntries[0]);
    }
  }, [dataEntries, selectedEntry]);

  const handleEntryClick = async (entry: string) => {
    setSelectedEntry(entry);
    try {
      const response = await axios.get(`${API_URL}/api/data/${entry}/parameters`);
      const parsedParams = response.data.split('\n').map((line: string) => {
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
    } catch (error) {
      console.error('Error fetching parameters:', error);
      setParameters([]);
    }
  };

  const renderParametersSidebarCard = () => (
    <div className="card sidebar-card mt-3">
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
      </main>
    );
  };

  return (
    <>
      <header className="navbar navbar-dark sticky-top bg-dark flex-md-nowrap p-0 shadow">
        <a className="navbar-brand col-md-3 col-lg-2 me-0 px-3" href="#">AD5940 Data Logger</a>
      </header>

      <div className="container-fluid">
        <div className="row">
          <nav id="sidebarMenu" className="col-md-3 col-lg-2 d-md-block bg-light sidebar collapse">
            <div className="position-sticky pt-3">
              <div className="card sidebar-card">
                <div className="card-header">
                  Data Entries
                </div>
                <div className="card-body">
                  <ul className="nav flex-column">
                    {dataEntries.map(entry => (
                      <li key={entry} className="nav-item">
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
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {renderParametersSidebarCard()}
            </div>
          </nav>
          {renderDetailView()}
        </div>
      </div>
    </>
  );
}

export default App;
