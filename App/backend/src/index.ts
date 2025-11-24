import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';

const app = express();
const port = 4000;
const dataDir = '/Users/xinye/Desktop/AD5940_DataLogger/Data';

app.use(cors());
app.use('/static', express.static(dataDir));

const getDataEntries = async () => {
  try {
    const entries = await fs.readdir(dataDir, { withFileTypes: true });
    const folders = entries
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort()
      .reverse();
    return folders;
  } catch (error) {
    console.error('Error reading data directory:', error);
    return [];
  }
};

app.get('/api/data', async (req, res) => {
  const entries = await getDataEntries();
  res.json(entries);
});

app.get('/api/data/:entryName/parameters', async (req, res) => {
    const { entryName } = req.params;
    const paramsPath = path.join(dataDir, entryName, 'parameters.txt');
    try {
        const params = await fs.readFile(paramsPath, 'utf-8');
        res.send(params);
    } catch (error) {
        res.status(404).send('Parameters not found');
    }
});

app.get('/api/data/:entryName/csv/:csvName', async (req, res) => {
    const { entryName, csvName } = req.params;
    const csvPath = path.join(dataDir, entryName, csvName);
    try {
        const csvData = await fs.readFile(csvPath, 'utf-8');
        res.send(csvData);
    } catch (error) {
        res.status(404).send('CSV file not found');
    }
});


app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
