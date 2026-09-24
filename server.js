const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const defaultData = {
        admin: { password: 'admin123' },
        users: [
          { id: 1, name: 'Jamil', password: 'jamil123' },
          { id: 2, name: 'Zameer', password: 'zameer123' },
          { id: 3, name: 'Ramzy', password: 'ramzy123' },
          { id: 4, name: 'Fath', password: 'fath123' }
        ],
        workers: [],
        jobs: [],
        nextJobId: 1,
        nextWorkerId: 1,
        nextUserId: 5,
        notifications: []
      };
      fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Error loading data:', e);
    return {
      admin: { password: 'admin123' },
      users: [],
      workers: [],
      jobs: [],
      nextJobId: 1,
      nextWorkerId: 1,
      nextUserId: 1,
      notifications: []
    };
  }
}

function saveData(data) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json());

// Smart static file serving - check public/ first, then root
const publicPath = path.join(__dirname, 'public');
const rootPath = __dirname;

if (fs.existsSync(publicPath) && fs.readdirSync(publicPath).length > 0) {
  // Use public/ folder if it exists and has files
  console.log('📁 Serving static files from: public/');
  app.use(express.static(publicPath));
} else {
  // Fallback to root folder
  console.log('📁 Serving static files from: root');
  app.use(express.static(rootPath));
}

// ===== AUTH =====
app.post('/api/auth/login', (req, res) => {
  const { role, name, password } = req.body;
  const data = loadData();

  if (role === 'admin') {
    if (password === data.admin.password) {
      return res.json({ token: 'admin', role: 'admin', name: 'Admin' });
    }
  } else if (role === 'user') {
    const user = data.users.find(u => u.name === name && u.password === password);
    if (user) {
      return res.json({ token: `user-${user.id}`, role: 'user', name: user.name, id: user.id });
    }
  } else if (role === 'worker') {
    const worker = data.workers.find(w => w.name === name && w.password === password);
    if (worker) {
      return res.json({ token: `worker-${worker.id}`, role: 'worker', name: worker.name, id: worker.id });
    }
  }

  res.status(401).json({ error: 'Invalid credentials' });
});

// ===== JOBS =====
app.get('/api/jobs', (req, res) => {
  const data = loadData();
  const token = req.headers['x-auth-token'];
  
  if (token && token.startsWith('worker-')) {
    const workerId = parseInt(token.split('-')[1]);
    const filtered = data.jobs.filter(j => j.workers && j.workers.includes(workerId));
    return res.json(filtered);
  }
  
  res.json(data.jobs);
});

app.post('/api/jobs', (req, res) => {
  const data = loadData();
  const jobId = data.nextJobId++;
  const job = {
    id: jobId,
    jobNo: req.body.jobNo || `JOB-${String(jobId).padStart(3, '0')}`,
    date: req.body.date || new Date().toISOString().split('T')[0],
    targetDate: req.body.targetDate || '',
    deliveryDate: req.body.deliveryDate || '',
    workers: req.body.workers || [],
    description: req.body.description || '',
    departments: req.body.departments || [],
    status: 'new',
    workerStatuses: {},
    createdAt: new Date().toISOString(),
    createdBy: req.body.createdBy || 'unknown'
  };

  // Initialize worker statuses
  if (job.workers.length > 0) {
    job.workers.forEach(wId => {
      job.workerStatuses[String(wId)] = { status: 'pending', days: 0, explanation: '', updatedAt: null };
    });
  }

  data.jobs.push(job);

  // Add notification for assigned workers
  job.workers.forEach(wId => {
    data.notifications.push({
      id: Date.now() + wId,
      workerId: wId,
      jobId: job.id,
      jobNo: job.jobNo,
      message: `New job assigned: ${job.jobNo}`,
      read: false,
      createdAt: new Date().toISOString()
    });
  });

  saveData(data);

  // Notify via Socket.IO
  io.emit('new-job', job);
  job.workers.forEach(wId => {
    io.emit('notification', { workerId: wId, jobNo: job.jobNo, message: `New job assigned: ${job.jobNo}` });
  });

  res.json(job);
});

app.put('/api/jobs/:id', (req, res) => {
  const data = loadData();
  const idx = data.jobs.findIndex(j => j.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });

  const oldJob = data.jobs[idx];
  const updatedFields = req.body;

  data.jobs[idx] = { ...data.jobs[idx], ...updatedFields };

  // If workers list changed, reinitialize statuses
  if (updatedFields.workers && JSON.stringify(updatedFields.workers) !== JSON.stringify(oldJob.workers)) {
    const newStatuses = {};
    updatedFields.workers.forEach(wId => {
      if (data.jobs[idx].workerStatuses[String(wId)]) {
        newStatuses[String(wId)] = data.jobs[idx].workerStatuses[String(wId)];
      } else {
        newStatuses[String(wId)] = { status: 'pending', days: 0, explanation: '', updatedAt: null };
      }
    });
    data.jobs[idx].workerStatuses = newStatuses;

    // Notify new workers
    const newWorkers = updatedFields.workers.filter(wId => !oldJob.workers.includes(wId));
    newWorkers.forEach(wId => {
      data.notifications.push({
        id: Date.now() + wId,
        workerId: wId,
        jobId: data.jobs[idx].id,
        jobNo: data.jobs[idx].jobNo,
        message: `You have been assigned to job: ${data.jobs[idx].jobNo}`,
        read: false,
        createdAt: new Date().toISOString()
      });
      io.emit('notification', { workerId: wId, jobNo: data.jobs[idx].jobNo, message: `You have been assigned to job: ${data.jobs[idx].jobNo}` });
    });
  }

  saveData(data);
  io.emit('job-updated', data.jobs[idx]);
  res.json(data.jobs[idx]);
});

app.delete('/api/jobs/:id', (req, res) => {
  const data = loadData();
  data.jobs = data.jobs.filter(j => j.id !== parseInt(req.params.id));
  saveData(data);
  io.emit('job-deleted', parseInt(req.params.id));
  res.json({ success: true });
});

app.put('/api/jobs/:id/status', (req, res) => {
  const data = loadData();
  const job = data.jobs.find(j => j.id === parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { workerId, status, days, explanation } = req.body;
  job.workerStatuses[String(workerId)] = {
    status,
    days: days || 0,
    explanation: explanation || '',
    updatedAt: new Date().toISOString()
  };

  // Check if all workers marked as done
  const allDone = job.workers.length > 0 && job.workers.every(wId => {
    const ws = job.workerStatuses[String(wId)];
    return ws && ws.status === 'done';
  });

  if (allDone) {
    job.status = 'finished';
  } else {
    const hasAnyUpdate = Object.values(job.workerStatuses).some(ws => ws.status !== 'pending');
    if (hasAnyUpdate && job.status === 'new') {
      job.status = 'pending';
    }
  }

  saveData(data);
  io.emit('job-updated', job);
  io.emit('status-updated', { jobId: job.id, workerId, status });
  res.json(job);
});

// Move job back to new or pending manually
app.put('/api/jobs/:id/move', (req, res) => {
  const data = loadData();
  const job = data.jobs.find(j => j.id === parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.status = req.body.status;
  saveData(data);
  io.emit('job-updated', job);
  res.json(job);
});

// ===== WORKERS =====
app.get('/api/workers', (req, res) => {
  const data = loadData();
  res.json(data.workers);
});

// Alias endpoint for settings
app.get('/api/workers/all', (req, res) => {
  const data = loadData();
  res.json(data.workers);
});

app.post('/api/workers', (req, res) => {
  const data = loadData();
  const worker = { id: data.nextWorkerId++, ...req.body };
  data.workers.push(worker);
  saveData(data);
  io.emit('workers-updated');
  res.json(worker);
});

app.put('/api/workers/:id', (req, res) => {
  const data = loadData();
  const idx = data.workers.findIndex(w => w.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Worker not found' });
  data.workers[idx] = { ...data.workers[idx], ...req.body };
  saveData(data);
  io.emit('workers-updated');
  res.json(data.workers[idx]);
});

app.delete('/api/workers/:id', (req, res) => {
  const data = loadData();
  data.workers = data.workers.filter(w => w.id !== parseInt(req.params.id));
  saveData(data);
  io.emit('workers-updated');
  res.json({ success: true });
});

// ===== USERS =====
app.get('/api/users', (req, res) => {
  const data = loadData();
  res.json(data.users);
});

app.post('/api/users', (req, res) => {
  const data = loadData();
  const user = { id: data.nextUserId++, ...req.body };
  data.users.push(user);
  saveData(data);
  io.emit('users-updated');
  res.json(user);
});

app.put('/api/users/:id', (req, res) => {
  const data = loadData();
  const idx = data.users.findIndex(u => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  data.users[idx] = { ...data.users[idx], ...req.body };
  saveData(data);
  io.emit('users-updated');
  res.json(data.users[idx]);
});

app.delete('/api/users/:id', (req, res) => {
  const data = loadData();
  data.users = data.users.filter(u => u.id !== parseInt(req.params.id));
  saveData(data);
  io.emit('users-updated');
  res.json({ success: true });
});

// ===== NOTIFICATIONS =====
app.get('/api/notifications/:workerId', (req, res) => {
  const data = loadData();
  const workerId = parseInt(req.params.workerId);
  const notifs = data.notifications.filter(n => n.workerId === workerId && !n.read);
  res.json(notifs);
});

app.put('/api/notifications/:workerId/read', (req, res) => {
  const data = loadData();
  const workerId = parseInt(req.params.workerId);
  data.notifications.forEach(n => {
    if (n.workerId === workerId) n.read = true;
  });
  saveData(data);
  res.json({ success: true });
});

// ===== SETTINGS =====
app.put('/api/settings/admin-password', (req, res) => {
  const data = loadData();
  data.admin.password = req.body.password;
  saveData(data);
  res.json({ success: true });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Work Manager running on http://0.0.0.0:${PORT}`);
  console.log(`📁 Static files served from: ${fs.existsSync(publicPath) && fs.readdirSync(publicPath).length > 0 ? 'public/' : 'root'}`);
});
