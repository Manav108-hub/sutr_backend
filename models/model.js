// models/model.js

const mongoose = require('mongoose');

// =====================
// CATEGORY SCHEMA
// =====================

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true,
    maxlength: [50, 'Category name cannot exceed 50 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  image: {
    url: {
      type: String,
      required: [true, 'Category image URL is required']
    },
    public_id: {
      type: String,
      required: [true, 'Category image public_id is required']
    }
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Generate slug from name before saving
categorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

// Index for active categories sorted by sortOrder
categorySchema.index({ isActive: 1, sortOrder: 1 });

const Category = mongoose.model('Category', categorySchema);

// =====================
// DRESS SCHEMA
// =====================

const dressSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Dress name is required'],
    trim: true,
    maxlength: [100, 'Dress name cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required']
  },
  images: [{
    url: {
      type: String,
      required: [true, 'Image URL is required']
    },
    public_id: {
      type: String,
      required: [true, 'Image public_id is required']
    },
    alt: {
      type: String,
      default: ''
    }
  }],
  price: {
    original: {
      type: Number,
      required: [true, 'Original price is required'],
      min: [0, 'Price cannot be negative']
    },
    discounted: {
      type: Number,
      min: [0, 'Discounted price cannot be negative'],
      validate: {
        validator: function(value) {
          // Only validate if a discounted price is provided
          return !value || value <= this.price.original;
        },
        message: 'Discounted price cannot exceed original price'
      }
    }
  },
  sizes: [{
    size: {
      type: String,
      required: [true, 'Size is required'],
      enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size', 'Custom']
    },
    available: {
      type: Boolean,
      default: true
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Stock cannot be negative']
    }
  }],
  colors: [{
    name: {
      type: String,
      required: [true, 'Color name is required']
    },
    code: {
      type: String, // e.g. '#FF0000'
      required: [true, 'Color code is required']
    },
    available: {
      type: Boolean,
      default: true
    }
  }],
  material: {
    type: String,
    trim: true,
    maxlength: [100, 'Material description cannot exceed 100 characters']
  },
  careInstructions: {
    type: String,
    trim: true,
    maxlength: [500, 'Care instructions cannot exceed 500 characters']
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  sku: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  whatsappNumber: {
    type: String,
    required: [true, 'WhatsApp number is required for orders'],
    validate: {
      validator: function(v) {
        // E.164 format (e.g. +911234567890)
        return /^\+?[1-9]\d{1,14}$/.test(v);
      },
      message: 'Please enter a valid WhatsApp number (with country code)'
    }
  },
  whatsappMessage: {
    type: String,
    default: 'Hi! I am interested in this dress: {dressName}. Please provide more details about pricing, availability, and delivery.',
    maxlength: [500, 'WhatsApp message template cannot exceed 500 characters']
  },
  views: {
    type: Number,
    default: 0
  },
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Indexes for better performance on common queries
dressSchema.index({ category: 1, isActive: 1 });
dressSchema.index({ isFeatured: 1, isActive: 1 });
dressSchema.index({ 'price.original': 1 });
dressSchema.index({ createdAt: -1 });
dressSchema.index({ tags: 1 });

// Pre-save hook: auto-generate a SKU if not provided
dressSchema.pre('save', async function(next) {
  if (!this.sku && this.isNew) {
    const count = await this.constructor.countDocuments();
    this.sku = `DRESS${String(count + 1).padStart(4, '0')}`; 
  }
  next();
});

// Virtual: compute discount percentage
dressSchema.virtual('discountPercentage').get(function() {
  if (this.price.discounted && this.price.original > 0) {
    return Math.round(
      ((this.price.original - this.price.discounted) / this.price.original) * 100
    );
  }
  return 0;
});

// Virtual: effective price (discounted or original)
dressSchema.virtual('effectivePrice').get(function() {
  return this.price.discounted || this.price.original;
});

// Virtual: generate a WhatsApp link
dressSchema.virtual('whatsappLink').get(function() {
  if (!this.whatsappNumber) return null;
  const cleanNumber = this.whatsappNumber.replace(/[\s+]/g, '');
  const message = this.whatsappMessage
    .replace('{dressName}', this.name)
    .replace('{dressPrice}', `₹${this.effectivePrice}`)
    .replace('{dressSKU}', this.sku || '')
    .replace('{dressCategory}', this.category?.name || '');
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${cleanNumber}?text=${encodedMessage}`;
});

// Ensure virtuals are included when converting to JSON / Object
dressSchema.set('toJSON', { virtuals: true });
dressSchema.set('toObject', { virtuals: true });

const Dress = mongoose.model('Dress', dressSchema);

module.exports = {
  Category,
  Dress
};
