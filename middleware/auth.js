// middleware/auth.js

const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

// ──────────────────────────────────────────────────────────────────────────────
// 1) protect()
//    Verifies a Bearer JWT in the `Authorization` header and attaches `req.user = { id, role }`.
//    If missing or invalid, returns 401 Unauthorized.
const protect = async (req, res, next) => {
  let token;

  // Look for token in Authorization header: "Bearer <token>"
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // decoded = { id: <userId>, role: 'admin' | 'user', iat, exp }
    req.user = { id: decoded.id, role: decoded.role };
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 2) adminOnly()
//    Must be used **after** protect(). Checks req.user.role === 'admin'.
//    If not, returns 403 Forbidden.
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied: admin only' });
};

module.exports = {
  protect,
  adminOnly
};
