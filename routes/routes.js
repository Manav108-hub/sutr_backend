// routes/routes.js

const express = require('express');
const router = express.Router();
const { Category, Dress } = require('../models/model');
const {
  deleteFromCloudinary,
  deleteMultipleFromCloudinary
} = require('../middleware/upload');

// Import auth middleware
const { protect, adminOnly } = require('../middleware/auth');

// =====================
// CATEGORY ROUTES
// =====================

// 1) GET /api/categories (public)
router.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .select('-__v');
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: error.message
    });
  }
});

// 2) GET /api/category/:identifier (public)
router.get('/category/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
    const query = isObjectId ? { _id: identifier } : { slug: identifier };

    const category = await Category.findOne({ ...query, isActive: true });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching category',
      error: error.message
    });
  }
});

// 3) POST /api/category (admin only)
//    Create a new category; expects JSON { name, description, sortOrder, imageUrl, public_id }
router.post(
  '/category',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { name, description, sortOrder, imageUrl, public_id } = req.body;

      if (!imageUrl || !public_id) {
        return res.status(400).json({
          success: false,
          message: 'imageUrl and public_id are required'
        });
      }

      const category = new Category({
        name,
        description,
        image: { url: imageUrl, public_id },
        sortOrder: sortOrder || 0
      });

      const savedCategory = await category.save();
      res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: savedCategory
      });
    } catch (error) {
      // If the DB save fails, remove the uploaded image from Cloudinary
      if (req.body.public_id) {
        await deleteFromCloudinary(req.body.public_id);
      }

      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Category name already exists'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error creating category',
        error: error.message
      });
    }
  }
);

// 4) PUT /api/category/:id (admin only)
//    Update fields and optionally replace its image
router.put(
  '/category/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, sortOrder, isActive, imageUrl, public_id } = req.body;

      const category = await Category.findById(id);
      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      // Update provided fields
      if (name) category.name = name;
      if (description !== undefined) category.description = description;
      if (sortOrder !== undefined) category.sortOrder = sortOrder;
      if (isActive !== undefined) category.isActive = isActive;

      // Replace image if provided
      if (imageUrl && public_id) {
        // Delete old Cloudinary image
        await deleteFromCloudinary(category.image.public_id);
        category.image = { url: imageUrl, public_id };
      }

      const updatedCategory = await category.save();
      res.json({
        success: true,
        message: 'Category updated successfully',
        data: updatedCategory
      });
    } catch (error) {
      // If update failed and a new image was uploaded, delete that new image
      if (req.body.public_id) {
        await deleteFromCloudinary(req.body.public_id);
      }

      res.status(500).json({
        success: false,
        message: 'Error updating category',
        error: error.message
      });
    }
  }
);

// 5) DELETE /api/category/:id (admin only)
//    Delete category only if no dresses reference it
router.delete(
  '/category/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const category = await Category.findById(id);
      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      // If there are dresses in this category, don’t delete
      const dressCount = await Dress.countDocuments({ category: id });
      if (dressCount > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete category. ${dressCount} dresses belong to this category.`
        });
      }

      // Delete the Cloudinary image
      await deleteFromCloudinary(category.image.public_id);

      // Delete the document
      await Category.findByIdAndDelete(id);

      res.json({
        success: true,
        message: 'Category deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting category',
        error: error.message
      });
    }
  }
);

// =====================
// DRESS ROUTES
// =====================

// 6) GET /api/dresses (public)
//    Get all active dresses with optional filters, pagination, sorting
router.get('/dresses', async (req, res) => {
  try {
    const {
      category,
      featured,
      minPrice,
      maxPrice,
      size,
      color,
      material,
      sort = '-createdAt',
      page = 1,
      limit = 12
    } = req.query;

    // Build filter object
    const filter = { isActive: true };

    if (category) filter.category = category;
    if (featured === 'true') filter.isFeatured = true;
    if (size) filter['sizes.size'] = size;
    if (color) filter['colors.name'] = new RegExp(color, 'i');
    if (material) filter.material = new RegExp(material, 'i');

    // Price range filter
    if (minPrice || maxPrice) {
      filter['price.original'] = {};
      if (minPrice) filter['price.original'].$gte = Number(minPrice);
      if (maxPrice) filter['price.original'].$lte = Number(maxPrice);
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Sort mapping
    const sortOptions = {
      '-createdAt': { createdAt: -1 },
      createdAt: { createdAt: 1 },
      price: { 'price.original': 1 },
      '-price': { 'price.original': -1 },
      name: { name: 1 },
      '-name': { name: -1 },
      featured: { isFeatured: -1, createdAt: -1 }
    };

    const dresses = await Dress.find(filter)
      .populate('category', 'name slug')
      .sort(sortOptions[sort] || { createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .select('-__v');

    const total = await Dress.countDocuments(filter);

    res.json({
      success: true,
      count: dresses.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: dresses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching dresses',
      error: error.message
    });
  }
});

// 7) GET /api/dresses/featured (public)
//    Get only featured dresses (limit optional)
router.get('/dresses/featured', async (req, res) => {
  try {
    const { limit = 8 } = req.query;
    const dresses = await Dress.find({ isActive: true, isFeatured: true })
      .populate('category', 'name slug')
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(parseInt(limit))
      .select('-__v');

    res.json({
      success: true,
      count: dresses.length,
      data: dresses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching featured dresses',
      error: error.message
    });
  }
});

// 8) GET /api/dresses/category/:categoryId (public)
//    Get dresses for a category (ID or slug), with pagination & sorting
router.get('/dresses/category/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { sort = '-createdAt', page = 1, limit = 12 } = req.query;

    // Verify category exists by ID or slug
    const category = await Category.findOne({
      $or: [{ _id: categoryId }, { slug: categoryId }],
      isActive: true
    });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {
      '-createdAt': { createdAt: -1 },
      createdAt: { createdAt: 1 },
      price: { 'price.original': 1 },
      '-price': { 'price.original': -1 },
      name: { name: 1 },
      featured: { isFeatured: -1, createdAt: -1 }
    };

    const dresses = await Dress.find({ category: category._id, isActive: true })
      .populate('category', 'name slug')
      .sort(sortOptions[sort] || { createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .select('-__v');

    const total = await Dress.countDocuments({ category: category._id, isActive: true });

    res.json({
      success: true,
      category: {
        id: category._id,
        name: category.name,
        slug: category.slug
      },
      count: dresses.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: dresses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching dresses by category',
      error: error.message
    });
  }
});

// 9) GET /api/dress/:id (public)
//    Get a single dress by ID, increment view‐count
router.get('/dress/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const dress = await Dress.findOne({ _id: id, isActive: true })
      .populate('category', 'name slug description')
      .select('-__v');

    if (!dress) {
      return res.status(404).json({
        success: false,
        message: 'Dress not found'
      });
    }

    // Increment view count (fire-and-forget)
    await Dress.findByIdAndUpdate(id, { $inc: { views: 1 } });

    res.json({ success: true, data: dress });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching dress',
      error: error.message
    });
  }
});

// 10) POST /api/dress (admin only)
//     Create a new dress; expects JSON including “images” array of { url, public_id, alt }
router.post(
  '/dress',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const {
        name,
        description,
        category,
        price,
        sizes,
        colors,
        material,
        careInstructions,
        tags,
        whatsappNumber,
        isFeatured,
        sortOrder,
        images
      } = req.body;

      // Must supply at least one image
      if (!images || !Array.isArray(images) || images.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one dress image is required in images array'
        });
      }

      // Parse JSON fields if they came in as strings
      let parsedSizes, parsedColors, parsedTags, parsedPrice;
      try {
        parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;
        parsedSizes = typeof sizes === 'string' ? JSON.parse(sizes) : sizes;
        parsedColors = typeof colors === 'string' ? JSON.parse(colors) : colors;
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          message: 'Invalid JSON format in request data'
        });
      }

      const dress = new Dress({
        name,
        description,
        category,
        price: parsedPrice,
        images, // each item: { url, public_id, alt }
        sizes: parsedSizes || [],
        colors: parsedColors || [],
        material,
        careInstructions,
        tags: parsedTags || [],
        whatsappNumber,
        isFeatured: isFeatured === true || isFeatured === 'true',
        sortOrder: sortOrder || 0
      });

      const savedDress = await dress.save();
      await savedDress.populate('category', 'name slug');

      res.status(201).json({
        success: true,
        message: 'Dress created successfully',
        data: savedDress
      });
    } catch (error) {
      // If saving fails, delete the uploaded images from Cloudinary
      if (req.body.images && Array.isArray(req.body.images)) {
        const publicIds = req.body.images.map((img) => img.public_id);
        await deleteMultipleFromCloudinary(publicIds);
      }
      res.status(500).json({
        success: false,
        message: 'Error creating dress',
        error: error.message
      });
    }
  }
);

// 11) PUT /api/dress/:id (admin only)
//     Update a dress’s fields, optionally remove/add images
router.put(
  '/dress/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        category,
        price,
        sizes,
        colors,
        material,
        careInstructions,
        tags,
        whatsappNumber,
        isFeatured,
        isActive,
        sortOrder,
        removeImages, // array of public_ids to remove
        newImages     // array of { url, public_id, alt } to add
      } = req.body;

      const dress = await Dress.findById(id);
      if (!dress) {
        return res.status(404).json({
          success: false,
          message: 'Dress not found'
        });
      }

      // Parse JSON fields if they came as strings
      let parsedSizes, parsedColors, parsedTags, parsedPrice, parsedRemoveImages;
      try {
        if (price) parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;
        if (sizes) parsedSizes = typeof sizes === 'string' ? JSON.parse(sizes) : sizes;
        if (colors) parsedColors = typeof colors === 'string' ? JSON.parse(colors) : colors;
        if (tags) parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (removeImages)
          parsedRemoveImages = Array.isArray(removeImages)
            ? removeImages
            : JSON.parse(removeImages);
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          message: 'Invalid JSON format in request data'
        });
      }

      // Update provided fields
      if (name) dress.name = name;
      if (description !== undefined) dress.description = description;
      if (category) dress.category = category;
      if (parsedPrice) dress.price = parsedPrice;
      if (parsedSizes) dress.sizes = parsedSizes;
      if (parsedColors) dress.colors = parsedColors;
      if (material) dress.material = material;
      if (careInstructions !== undefined) dress.careInstructions = careInstructions;
      if (parsedTags) dress.tags = parsedTags;
      if (whatsappNumber) dress.whatsappNumber = whatsappNumber;
      if (isFeatured !== undefined) dress.isFeatured = isFeatured === true || isFeatured === 'true';
      if (isActive !== undefined) dress.isActive = isActive === true || isActive === 'true';
      if (sortOrder !== undefined) dress.sortOrder = sortOrder;

      // 1) Remove images if requested
      if (parsedRemoveImages && parsedRemoveImages.length > 0) {
        // Delete from Cloudinary
        await deleteMultipleFromCloudinary(parsedRemoveImages);
        // Filter out from the `images` array
        dress.images = dress.images.filter(
          (img) => !parsedRemoveImages.includes(img.public_id)
        );
      }

      // 2) Add new images if provided
      if (newImages && Array.isArray(newImages) && newImages.length > 0) {
        // Each newImages item = { url, public_id, alt }
        dress.images.push(...newImages);
      }

      // Ensure there’s at least one image remaining
      if (dress.images.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Dress must have at least one image'
        });
      }

      const updatedDress = await dress.save();
      await updatedDress.populate('category', 'name slug');

      res.json({
        success: true,
        message: 'Dress updated successfully',
        data: updatedDress
      });
    } catch (error) {
      // If new images were added but error occurred, delete them
      if (req.body.newImages && Array.isArray(req.body.newImages)) {
        const publicIds = req.body.newImages.map((img) => img.public_id);
        await deleteMultipleFromCloudinary(publicIds);
      }

      res.status(500).json({
        success: false,
        message: 'Error updating dress',
        error: error.message
      });
    }
  }
);

// 12) DELETE /api/dress/:id (admin only)
//     Delete a dress and all its images
router.delete(
  '/dress/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const dress = await Dress.findById(id);
      if (!dress) {
        return res.status(404).json({
          success: false,
          message: 'Dress not found'
        });
      }

      // Delete all Cloudinary images
      const publicIds = dress.images.map((img) => img.public_id);
      if (publicIds.length > 0) {
        await deleteMultipleFromCloudinary(publicIds);
      }

      // Delete dress document
      await Dress.findByIdAndDelete(id);

      res.json({
        success: true,
        message: 'Dress deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting dress',
        error: error.message
      });
    }
  }
);

// 13) GET /api/dresses/search (public)
//     Search dresses by keywords (name, description, material, tags)
router.get('/dresses/search', async (req, res) => {
  try {
    const {
      q,
      category,
      minPrice,
      maxPrice,
      sort = '-createdAt',
      page = 1,
      limit = 12
    } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query (q) is required'
      });
    }

    // Build search filter
    const filter = {
      isActive: true,
      $or: [
        { name: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') },
        { material: new RegExp(q, 'i') },
        { tags: new RegExp(q, 'i') }
      ]
    };

    if (category) filter.category = category;

    if (minPrice || maxPrice) {
      filter['price.original'] = {};
      if (minPrice) filter['price.original'].$gte = Number(minPrice);
      if (maxPrice) filter['price.original'].$lte = Number(maxPrice);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {
      '-createdAt': { createdAt: -1 },
      createdAt: { createdAt: 1 },
      price: { 'price.original': 1 },
      '-price': { 'price.original': -1 },
      name: { name: 1 },
      relevance: { score: { $meta: 'textScore' } }
    };

    const dresses = await Dress.find(filter)
      .populate('category', 'name slug')
      .sort(sortOptions[sort] || { createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .select('-__v');

    const total = await Dress.countDocuments(filter);

    res.json({
      success: true,
      query: q,
      count: dresses.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: dresses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error searching dresses',
      error: error.message
    });
  }
});

module.exports = router;
