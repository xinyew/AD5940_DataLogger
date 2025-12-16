import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';
import { BleManager } from './bleManager';

const app = express();
const port = 4000;
const dataDir = '/Users/xinye/Desktop/AD5940_DataLogger/Data';

app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies
app.use('/static', express.static(dataDir));

const bleManager = new BleManager(dataDir);

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

// --- BLE Logger Endpoints ---

app.get('/api/devices', async (req, res) => {
    try {
        const devices = await bleManager.scanDevices();
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: 'Failed to scan devices' });
    }
});

app.post('/api/connect', (req, res) => {
    const { deviceName } = req.body;
    if (!deviceName) {
        res.status(400).json({ error: 'Device name is required' });
        return;
    }
    try {
        bleManager.connect(deviceName);
        res.json({ success: true, message: 'Connection initiated' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/disconnect', (req, res) => {
    try {
        bleManager.disconnect();
        res.json({ success: true, message: 'Disconnect initiated' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/trigger', (req, res) => {
    try {
        bleManager.triggerRead();
        res.json({ success: true, message: 'Read triggered' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/logs', (req, res) => {
    res.json(bleManager.getLogs());
});

app.get('/api/status', (req, res) => {
    res.json(bleManager.getStatus());
});

// --- Existing Endpoints ---

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

app.get('/api/data/:entryName/comment', async (req, res) => {
    const { entryName } = req.params;
    const commentPath = path.join(dataDir, entryName, 'comment.txt');
    try {
        const comment = await fs.readFile(commentPath, 'utf-8');
        res.json({ comment });
    } catch (error) {
        // If the file doesn't exist, return an empty comment
        res.json({ comment: '' });
    }
});

app.post('/api/data/:entryName/comment', async (req, res) => {
    const { entryName } = req.params;
    const { comment } = req.body;
    const commentPath = path.join(dataDir, entryName, 'comment.txt');
    try {
        await fs.writeFile(commentPath, comment, 'utf-8');
        res.status(200).send('Comment saved');
    } catch (error) {
        console.error('Error saving comment:', error);
        res.status(500).send('Error saving comment');
    }
});

const tagsPath = path.join(dataDir, 'tags.json');

app.get('/api/tags', async (req, res) => {
    try {
        const tags = await fs.readFile(tagsPath, 'utf-8');
        res.json(JSON.parse(tags));
    } catch (error) {
        // If the file doesn't exist, return an empty object
        res.json({});
    }
});

app.post('/api/tags', async (req, res) => {
    const { tags } = req.body;
    try {
        await fs.writeFile(tagsPath, JSON.stringify(tags, null, 2), 'utf-8');
        res.status(200).send('Tags saved');
    } catch (error) {
        console.error('Error saving tags:', error);
        res.status(500).send('Error saving tags');
    }
});

app.delete('/api/data/:entryName', async (req, res) => {
    const { entryName } = req.params;
    const entryPath = path.join(dataDir, entryName);
    try {
        await fs.rm(entryPath, { recursive: true, force: true });
        res.status(200).send('Entry deleted');
    } catch (error) {
        console.error('Error deleting entry:', error);
        res.status(500).send('Error deleting entry');
    }
});


app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
