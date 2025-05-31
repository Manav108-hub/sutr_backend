// server.js

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env
dotenv.config();

// Create a logs directory (if it doesn’t exist)
const logDirectory = path.join(__dirname, 'logs');
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

// Create a write stream in append mode for HTTP access logs
const accessLogStream = fs.createWriteStream(
  path.join(logDirectory, 'access.log'),
  { flags: 'a' }
);

// Initialize Express app
const app = express();

// ──────────────────────────────────────────────────────────────────────────────
// 1) REQUEST LOGGING with Morgan
//    - “combined” format (remote IP, method, URL, status, user-agent, etc.)
//    - Logs to both console (dev) and `logs/access.log` (combined).
app.use(morgan('combined', { stream: accessLogStream }));
app.use(morgan('dev')); // also log to console in dev format

// ──────────────────────────────────────────────────────────────────────────────
// 2) CORS MIDDLEWARE
//    Only allow requests from your FRONTEND_URL (e.g. http://localhost:3000)
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// 3) BODY PARSING (increase limit for large JSON payloads if needed)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ──────────────────────────────────────────────────────────────────────────────
// 4) AUTH ROUTES
//    Register & Login endpoints (no protection needed here)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ──────────────────────────────────────────────────────────────────────────────
// 5) APPLICATION ROUTES (Category & Dress)
//    These will be protected inside the router itself (using auth middleware)
const routes = require('./routes/routes');
app.use('/api', routes);

// ──────────────────────────────────────────────────────────────────────────────
// 6) HEALTH CHECK ENDPOINT
app.get('/', (req, res) => {
  res.json({
    message: 'Dress Catalog Backend API is running!',
    version: '1.0.0',
    endpoints: {
      'POST   /api/auth/register': 'Register a new user',
      'POST   /api/auth/login': 'Log in (returns JWT)',
      'GET    /api/categories': 'Get all categories (public)',
      'GET    /api/category/:identifier': 'Get single category by ID or slug (public)',
      'POST   /api/category': 'Create new category (admin only)',
      'PUT    /api/category/:id': 'Update category (admin only)',
      'DELETE /api/category/:id': 'Delete category (admin only)',
      'GET    /api/dresses': 'Get all dresses (public)',
      'GET    /api/dresses/featured': 'Get featured dresses (public)',
      'GET    /api/dresses/category/:categoryId': 'Get dresses by category (public)',
      'GET    /api/dress/:id': 'Get single dress details (public)',
      'GET    /api/dresses/search': 'Search dresses (public)',
      'POST   /api/dress': 'Create new dress (admin only)',
      'PUT    /api/dress/:id': 'Update dress (admin only)',
      'DELETE /api/dress/:id': 'Delete dress (admin only)'
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7) GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  // Log error details to error.log
  const errorEntry = `${new Date().toISOString()} - ERROR: ${err.message} - ${req.method} ${req.originalUrl}\n`;
  fs.appendFile(path.join(logDirectory, 'error.log'), errorEntry, (writeErr) => {
    if (writeErr) console.error('Failed to write to error.log:', writeErr);
  });

  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8) 404 HANDLER (for any routes not matched above)
app.use((req, res) => {
  const notFoundEntry = `${new Date().toISOString()} - 404: ${req.method} ${req.originalUrl}\n`;
  fs.appendFile(path.join(logDirectory, 'error.log'), notFoundEntry, (writeErr) => {
    if (writeErr) console.error('Failed to write to error.log:', writeErr);
  });

  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9) MONGODB CONNECTION
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    console.log('   Database:', mongoose.connection.name);
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => {
  console.log('❌ MongoDB disconnected');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

// ──────────────────────────────────────────────────────────────────────────────
// 10) START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV}`);
  console.log(`🌐 Access API at: http://localhost:${PORT}`);
});
