// routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
//    Register a new user (default role='user'; only manually seed an admin initially)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, email, and password'
      });
    }

    // Check if username or email is already taken
    const existing = await User.findOne({
      $or: [{ email }, { username }]
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already in use'
      });
    }

    // Only allow role='admin' if explicitly set (you can remove this in production
    // and manually assign admin via the database or a separate script)
    const user = new User({
      username,
      email,
      password,
      role: role === 'admin' ? 'admin' : 'user'
    });

    await user.save();

    return res.status(201).json({
      success: true,
      message: 'User registered successfully'
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while registering',
      error: error.message
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
//    Authenticate user and return a JWT
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Create JWT payload
    const payload = {
      id: user._id,
      role: user.role
    };

    // Sign token for 7 days
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while logging in',
      error: error.message
    });
  }
});

module.exports = router;
