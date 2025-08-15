require('dotenv').config();
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

// MongoDB connection with environment variables
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/scheme-portal';

// MongoDB connection options
const mongoOptions = {
    serverSelectionTimeoutMS: 10000, // Increase timeout to 10 seconds
    socketTimeoutMS: 45000,
    family: 4, // Use IPv4
    maxPoolSize: 10,
    connectTimeoutMS: 10000,
    retryWrites: true,
    w: 'majority'
};

// Function to connect to MongoDB with retry logic
async function connectToMongoDB() {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            console.log(`Attempting to connect to MongoDB (Attempt ${retryCount + 1}/${maxRetries})...`);
            
            // Close any existing connections first
            if (mongoose.connection.readyState === 1) {
                await mongoose.disconnect();
            }
            
            // Connect with the new connection options
            await mongoose.connect(MONGODB_URI, mongoOptions);
            
            // Verify the connection with a simple query
            await mongoose.connection.db.command({ ping: 1 });
            
            console.log('✅ Successfully connected to MongoDB');
            console.log(`MongoDB Host: ${mongoose.connection.host}`);
            console.log(`MongoDB Database: ${mongoose.connection.name || 'default'}`);
            
            // Connection event handlers
            mongoose.connection.on('error', (err) => {
                console.error('MongoDB connection error:', err);
            });
            
            mongoose.connection.on('disconnected', () => {
                console.log('MongoDB disconnected');
            });
            
            return true; // Successfully connected
            
        } catch (error) {
            retryCount++;
            console.error(`❌ MongoDB connection attempt ${retryCount} failed:`, error.message);
            
            if (retryCount === maxRetries) {
                console.error('❌ Maximum number of retries reached. Could not connect to MongoDB.');
                console.error('Error details:', error);
                return false;
            }
            
            // Wait for 2 seconds before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    return false;
}

// Start the server only after MongoDB connection is established
async function startServer() {
    try {
        const isConnected = await connectToMongoDB();
        if (!isConnected) {
            console.error('Failed to connect to MongoDB after multiple attempts');
            process.exit(1);
        }
        
        // Start the server
        const port = process.env.PORT || 3000;
        app.listen(port, '0.0.0.0', () => {
            console.log(`Server is running on port ${port}`);
        });
        
    } catch (error) {
        console.error('Fatal error during server startup:', error);
        process.exit(1);
    }
}

// Start the application
startServer();

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

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

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
        console.log('Registration attempt:', { email: req.body.email, role: req.body.role });
        const { email, password, role } = req.body;
        
        // Input validation
        if (!email || !password) {
            console.log('Missing required fields');
            return res.status(400).json({ message: 'Email and password are required' });
        }
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log('User already exists:', email);
            return res.status(400).json({ message: 'User already exists' });
        }
        
        // Create new user
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ 
            email, 
            password: hashedPassword, 
            role: role || 'citizen' // Default role
        });
        
        await user.save();
        console.log('User registered successfully:', email);
        res.status(201).json({ 
            success: true,
            message: 'User registered successfully',
            userId: user._id
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ 
            success: false,
            message: 'Error registering user',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        console.log('Login attempt:', { email: req.body.email });
        const { email, password } = req.body;

        // Input validation
        if (!email || !password) {
            console.log('Missing email or password');
            return res.status(400).json({ 
                success: false,
                message: 'Email and password are required' 
            });
        }

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found:', email);
            return res.status(401).json({ 
                success: false,
                message: 'Invalid email or password' 
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            console.log('Invalid password for user:', email);
            return res.status(401).json({ 
                success: false,
                message: 'Invalid email or password' 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                id: user._id, 
                role: user.role,
                email: user.email
            }, 
            JWT_SECRET, 
            { 
                expiresIn: '24h', // Increased from 1h to 24h for better user experience
                algorithm: 'HS256'
            }
        );

        console.log('Login successful for user:', email);
        res.json({ 
            success: true,
            message: 'Login successful',
            token,
            role: user.role,
            email: user.email
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ 
            success: false,
            message: 'Error during login',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
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

// Use the PORT environment variable for Render, fallback to 3000 for local development
const port = process.env.PORT || 3000;

// Start the server after MongoDB connection is established
connectToMongoDB().then(() => {
    app.listen(port, '0.0.0.0', () => {
        console.log(`Server is running on port ${port}`);
    });
}).catch(err => {
    console.error('Fatal error during MongoDB connection:', err);
    process.exit(1);
});

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