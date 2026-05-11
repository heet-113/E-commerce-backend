import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET || 'dev-only-secret';
const corsOrigin = process.env.CORS_ORIGIN || '*';

app.use(
  cors({
    origin: corsOrigin === '*' ? '*' : corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(express.json());

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0 },
    accent: { type: String, required: true, trim: true },
    featured: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
  },
  { timestamps: true },
);

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    status: { type: String, enum: ['Placed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'], default: 'Placed' },
    shipping: {
      fullName: { type: String, required: true },
      email: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      country: { type: String, required: true },
      postalCode: { type: String, required: true },
    },
  },
  { timestamps: true },
);

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

const seedProducts = [
  {
    name: 'Aurora Wireless Headphones',
    description: 'Noise-isolating audio with 30-hour battery life and soft-touch ear cushions.',
    category: 'Audio',
    price: 129.99,
    stock: 24,
    accent: '#0f766e',
    featured: true,
  },
  {
    name: 'Nimbus Smart Watch',
    description: 'Health tracking, notification sync, and weather-ready titanium casing.',
    category: 'Wearables',
    price: 189.0,
    stock: 18,
    accent: '#2563eb',
    featured: true,
  },
  {
    name: 'Luma Desk Lamp',
    description: 'Adjustable warm-to-cool light for focused work and evening ambience.',
    category: 'Home Office',
    price: 79.5,
    stock: 31,
    accent: '#d97706',
    featured: false,
  },
  {
    name: 'Vertex Mechanical Keyboard',
    description: 'Hot-swappable switches, aluminum frame, and a satisfying low-profile layout.',
    category: 'Computing',
    price: 149.0,
    stock: 14,
    accent: '#7c3aed',
    featured: false,
  },
  {
    name: 'Orbit Water Bottle',
    description: 'Double-wall insulated bottle that keeps drinks cold for hours.',
    category: 'Lifestyle',
    price: 34.99,
    stock: 52,
    accent: '#059669',
    featured: false,
  },
  {
    name: 'Pulse Fitness Band',
    description: 'Lightweight activity tracking with sleep insights and guided workouts.',
    category: 'Fitness',
    price: 59.99,
    stock: 40,
    accent: '#db2777',
    featured: true,
  },
];

const seedUsers = [
  {
    name: 'Admin',
    email: 'admin@test.com',
    password: 'admin@123',
    role: 'admin',
  },
];

function createOrderNumber() {
  return `ORD-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString().slice(-4)}`;
}

function safeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function authMiddleware(requiredRoles = []) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;

      if (!token) {
        return res.status(401).json({ message: 'Missing authentication token.' });
      }

      const payload = jwt.verify(token, jwtSecret);
      const user = await User.findById(payload.sub);

      if (!user) {
        return res.status(401).json({ message: 'User session is no longer valid.' });
      }

      if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
        return res.status(403).json({ message: 'You do not have permission to perform this action.' });
      }

      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({ message: 'Authentication failed.' });
    }
  };
}

function normalizeItems(items = []) {
  const map = new Map();

  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    const productId = String(item.productId || '');

    if (!productId || quantity < 1) {
      continue;
    }

    const existing = map.get(productId) || 0;
    map.set(productId, existing + quantity);
  }

  return [...map.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

async function seedDatabase() {
  const productCount = await Product.countDocuments();

  for (const seed of seedUsers) {
    const passwordHash = await bcrypt.hash(seed.password, 10);

    await User.findOneAndUpdate(
      { email: seed.email },
      {
        $set: {
          name: seed.name,
          passwordHash,
          role: seed.role,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
  }

  if (productCount === 0) {
    await Product.insertMany(seedProducts);
  }
}

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    service: 'ecommerce-backend',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'connecting',
    time: new Date().toISOString(),
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const token = jwt.sign({ sub: user._id.toString(), role: user.role }, jwtSecret, { expiresIn: '7d' });

  return res.json({
    token,
    user: safeUser(user),
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedName = String(name || '').trim();

  if (!normalizedName || !normalizedEmail || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required.' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
  }

  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    return res.status(409).json({ message: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  const user = await User.create({
    name: normalizedName,
    email: normalizedEmail,
    passwordHash,
    role: 'user',
  });

  const token = jwt.sign({ sub: user._id.toString(), role: user.role }, jwtSecret, { expiresIn: '7d' });

  return res.status(201).json({
    token,
    user: safeUser(user),
  });
});

app.get('/api/auth/me', authMiddleware(), async (req, res) => {
  return res.json({ user: safeUser(req.user) });
});

app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ featured: -1, createdAt: -1 });
  return res.json({ products });
});

app.post('/api/products', authMiddleware(['admin']), async (req, res) => {
  const { name, description, category, price, stock, accent, featured } = req.body || {};

  if (!name || !description || !category) {
    return res.status(400).json({ message: 'Name, description, and category are required.' });
  }

  const product = await Product.create({
    name: String(name).trim(),
    description: String(description).trim(),
    category: String(category).trim(),
    price: Number(price),
    stock: Number(stock),
    accent: String(accent || '#2563eb'),
    featured: Boolean(featured),
  });

  return res.status(201).json({ product });
});

app.put('/api/products/:id', authMiddleware(['admin']), async (req, res) => {
  const updates = {};
  const fields = ['name', 'description', 'category', 'price', 'stock', 'accent', 'featured'];

  for (const field of fields) {
    if (field in req.body) {
      updates[field] = req.body[field];
    }
  }

  if (updates.price !== undefined) {
    updates.price = Number(updates.price);
  }

  if (updates.stock !== undefined) {
    updates.stock = Number(updates.stock);
  }

  if (updates.featured !== undefined) {
    updates.featured = Boolean(updates.featured);
  }

  const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

  if (!product) {
    return res.status(404).json({ message: 'Product not found.' });
  }

  return res.json({ product });
});

app.delete('/api/products/:id', authMiddleware(['admin']), async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product) {
    return res.status(404).json({ message: 'Product not found.' });
  }

  return res.json({ message: 'Product deleted.' });
});

app.get('/api/orders', authMiddleware(), async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { userId: req.user._id };
  const orders = await Order.find(filter).sort({ createdAt: -1 });
  return res.json({ orders });
});

app.post('/api/orders', authMiddleware(), async (req, res) => {
  const { items = [], shipping = {} } = req.body || {};
  const normalizedItems = normalizeItems(items);

  if (normalizedItems.length === 0) {
    return res.status(400).json({ message: 'At least one cart item is required.' });
  }

  const requiredFields = ['fullName', 'email', 'address', 'city', 'country', 'postalCode'];
  for (const field of requiredFields) {
    if (!String(shipping[field] || '').trim()) {
      return res.status(400).json({ message: `Shipping field ${field} is required.` });
    }
  }

  const productIds = normalizedItems.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));

  for (const item of normalizedItems) {
    const product = productMap.get(item.productId);

    if (!product) {
      return res.status(400).json({ message: 'One or more products are no longer available.' });
    }

    if (product.stock < item.quantity) {
      return res.status(400).json({ message: `Not enough stock for ${product.name}.` });
    }
  }

  const orderItems = normalizedItems.map((item) => {
    const product = productMap.get(item.productId);
    return {
      productId: product._id,
      name: product.name,
      category: product.category,
      price: product.price,
      quantity: item.quantity,
    };
  });

  const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  for (const item of orderItems) {
    const product = productMap.get(item.productId.toString());
    product.stock -= item.quantity;
    await product.save();
  }

  const order = await Order.create({
    orderNumber: createOrderNumber(),
    userId: req.user._id,
    items: orderItems,
    subtotal,
    shipping: {
      fullName: String(shipping.fullName).trim(),
      email: String(shipping.email).trim(),
      address: String(shipping.address).trim(),
      city: String(shipping.city).trim(),
      country: String(shipping.country).trim(),
      postalCode: String(shipping.postalCode).trim(),
    },
  });

  return res.status(201).json({ order });
});

app.patch('/api/orders/:id/status', authMiddleware(['admin']), async (req, res) => {
  const { status } = req.body || {};
  const allowedStatus = ['Placed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];

  if (!allowedStatus.includes(status)) {
    return res.status(400).json({ message: 'Invalid order status.' });
  }

  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });

  if (!order) {
    return res.status(404).json({ message: 'Order not found.' });
  }

  return res.json({ order });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: 'Internal server error.' });
});

async function start() {
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required to start the backend.');
  }

  await mongoose.connect(mongoUri);
  await seedDatabase();

  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
