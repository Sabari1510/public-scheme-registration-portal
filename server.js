const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (including index.html and favicon.ico if present)
app.use(express.static(path.join(__dirname)));

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle favicon.ico requests gracefully
app.get('/favicon.ico', (req, res) => res.status(204).end());

mongoose.connect('mongodb://localhost/scheme-portal', { useNewUrlParser: true, useUnifiedTopology: true });

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: String,
    role: { type: String, enum: ['citizen', 'admin'], default: 'citizen' }
});
const User = mongoose.model('User', userSchema);

const schemeSchema = new mongoose.Schema({
    name: String,
    description: String,
    eligibilityCriteria: String
});
const Scheme = mongoose.model('Scheme', schemeSchema);

const applicationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    schemeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scheme' },
    formData: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    adminRemarks: String,
    createdAt: { type: Date, default: Date.now }
});
const Application = mongoose.model('Application', applicationSchema);

const JWT_SECRET = 'your_jwt_secret';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
}

function isAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
    next();
}

app.post('/api/register', async (req, res) => {
    try {
        const { email, password, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashedPassword, role });
        await user.save();
        res.status(201).json({ message: 'User registered' });
    } catch (err) {
        res.status(400).json({ message: 'Error registering user' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, role: user.role });
    } catch (err) {
        res.status(500).json({ message: 'Error logging in' });
    }
});

app.get('/api/schemes', authenticateToken, async (req, res) => {
    const schemes = await Scheme.find();
    res.json(schemes);
});

app.post('/api/apply', authenticateToken, async (req, res) => {
    try {
        const { schemeId, formData } = req.body;
        const application = new Application({
            userId: req.user.id,
            schemeId,
            formData
        });
        await application.save();
        res.json({ applicationId: application._id });
    } catch (err) {
        res.status(400).json({ message: 'Error submitting application' });
    }
});

app.get('/api/application/:id/status', authenticateToken, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application || application.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        res.json({ status: application.status });
    } catch (err) {
        res.status(400).json({ message: 'Error checking status' });
    }
});

app.get('/api/admin/applications', authenticateToken, isAdmin, async (req, res) => {
    const applications = await Application.find().populate('schemeId');
    res.json(applications);
});

app.put('/api/admin/application/:id/review', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { decision, remarks } = req.body;
        const application = await Application.findById(req.params.id);
        if (!application) return res.status(404).json({ message: 'Application not found' });
        application.status = decision;
        application.adminRemarks = remarks;
        await application.save();
        res.json({ message: 'Application updated' });
    } catch (err) {
        res.status(400).json({ message: 'Error reviewing application' });
    }
});

app.listen(3000, () => console.log('Server running on port http://localhost:3000'));

// Initialize some sample schemes
async function initSchemes() {
    const count = await Scheme.countDocuments();
    if (count === 0) {
        await Scheme.insertMany([
            { name: 'Welfare Scheme 1', description: 'Support for low-income families', eligibilityCriteria: 'Income < 100000' },
            { name: 'Welfare Scheme 2', description: 'Education grant', eligibilityCriteria: 'Student with GPA > 3.0' }
        ]);
    }
}
initSchemes();