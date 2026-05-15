const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const xlsx = require('xlsx');
require('dotenv').config();

const Product = require('./src/models/Product');
const InventoryItem = require('./src/models/InventoryItem');
const Sale = require('./src/models/Sale');
const { buildOcrSuggestion } = require('./src/services/ocrSuggestion');
const {
  cleanupFiles,
  createOcrImageVariants,
} = require('./src/services/imagePreprocess');

const app = express();
const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/shop_erp';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
const visionClient = createVisionClient();
const importJobs = new Map();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/products/lookup/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const { shopCode } = req.query;
    const barcodeVariants = getBarcodeVariants(barcode);

    const product = await Product.findOne({ barcode: { $in: barcodeVariants } }).lean();
    if (!product) {
      return res.json({ product: null, inventoryItem: null });
    }

    let inventoryItem = null;
    if (shopCode) {
      inventoryItem = await InventoryItem.findOne({
        shopCode,
        product: product._id,
      })
        .populate('product')
        .lean();
    }

    return res.json({ product, inventoryItem });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post('/api/products/ocr-suggest', upload.single('image'), async (req, res) => {
  let tempFilePaths = [];

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Product image is required' });
    }

    tempFilePaths = await createOcrImageVariants(req.file.buffer);
    const rawText = await runTesseractOnVariants(tempFilePaths);
    const catalog = await Product.find().lean();
    const suggestion = buildOcrSuggestion(rawText, catalog);

    return res.json(suggestion);
  } catch (error) {
    if (
      error.code === 7 ||
      /Could not load the default credentials|Could not load credentials|permission/i.test(
        error.message,
      )
    ) {
      return res.status(503).json({
        message:
          'Google Vision OCR is not configured correctly. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file with Vision API access.',
        detail: error.message,
      });
    }

    return res.status(500).json({
      message: error.message,
      detail: error.details || error.stack,
    });
  } finally {
    if (tempFilePaths.length) {
      await cleanupFiles(tempFilePaths);
    }
  }
});

app.post('/api/products/upsert', async (req, res) => {
  try {
    const {
      shopCode,
      barcode,
      name,
      brand,
      category,
      subCategory,
      quantity,
      unit,
      packSize,
      mrp,
      sellingPrice,
      openingStock = 0,
      newStock = 0,
      initialStock = 0,
    } = req.body;

    if (!shopCode || !name) {
      return res.status(400).json({ message: 'shopCode and name are required' });
    }

    const normalizedSellingPrice =
      sellingPrice === undefined || sellingPrice === null || sellingPrice === ''
        ? 0
        : Number(sellingPrice);
    const normalizedQuantity =
      quantity === undefined || quantity === null || quantity === ''
        ? undefined
        : Number(quantity);
    const normalizedPackSize =
      packSize || buildPackSize(normalizedQuantity, unit);
    const normalizedOpeningStock = Number(openingStock ?? initialStock) || 0;
    const normalizedNewStock = Number(newStock) || 0;

    let product;
    if (barcode) {
      product = await Product.findOne({ barcode: { $in: getBarcodeVariants(barcode) } });
    }

    if (product) {
      product.name = name;
      product.brand = brand;
      product.category = category;
      product.subCategory = subCategory;
      product.quantity = normalizedQuantity;
      product.unit = unit;
      product.packSize = normalizedPackSize;
      product.mrp = mrp;
      product.sellingPrice = normalizedSellingPrice;
      await product.save();
    } else {
      product = await Product.create({
        barcode,
        name,
        brand,
        category,
        subCategory,
        quantity: normalizedQuantity,
        unit,
        packSize: normalizedPackSize,
        mrp,
        sellingPrice: normalizedSellingPrice,
      });
    }

    let inventoryItem = await InventoryItem.findOne({
      shopCode,
      product: product._id,
    });

    if (inventoryItem) {
      inventoryItem.stock += normalizedNewStock;
      await inventoryItem.save();
      await inventoryItem.populate('product');
    } else {
      inventoryItem = await InventoryItem.findOneAndUpdate(
        {
          shopCode,
          product: product._id,
        },
        {
          $set: { stock: normalizedOpeningStock + normalizedNewStock },
        },
        {
          new: true,
          upsert: true,
        },
      ).populate('product');
    }

    return res.status(201).json({ product, inventoryItem });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Barcode already exists in the catalog' });
    }

    return res.status(500).json({ message: error.message });
  }
});

app.post('/api/admin/products', async (req, res) => {
  try {
    const {
      barcode,
      name,
      brand,
      quantity,
      unit,
      category,
      subCategory,
    } = req.body;

    if (!barcode || !name || !brand || quantity === undefined || !unit || !category) {
      return res.status(400).json({
        message: 'barcode, name, brand, quantity, unit and category are required',
      });
    }

    const normalizedBarcode = String(barcode).trim();
    const normalizedName = String(name).trim();
    const normalizedBrand = String(brand).trim();
    const normalizedCategory = String(category).trim();
    const normalizedSubCategory = String(subCategory).trim();
    const normalizedUnit = String(unit).trim();
    const normalizedQuantity = Number(quantity);

    if (!normalizedBarcode || !normalizedName || !normalizedBrand || !normalizedCategory) {
      return res.status(400).json({ message: 'Text fields cannot be empty' });
    }

    if (Number.isNaN(normalizedQuantity) || normalizedQuantity <= 0) {
      return res.status(400).json({ message: 'quantity must be greater than 0' });
    }

    const product = await Product.findOneAndUpdate(
      { barcode: { $in: getBarcodeVariants(normalizedBarcode) } },
      {
        $set: {
          barcode: normalizedBarcode,
          name: normalizedName,
          brand: normalizedBrand,
          quantity: normalizedQuantity,
          unit: normalizedUnit,
          category: normalizedCategory,
          subCategory: normalizedSubCategory || undefined,
          packSize: buildPackSize(normalizedQuantity, normalizedUnit),
        },
        $setOnInsert: {
          sellingPrice: 0,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    );

    return res.status(201).json({ product });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Barcode already exists in the catalog' });
    }

    return res.status(500).json({ message: error.message });
  }
});

app.post('/api/admin/products/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Excel file is required' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ message: 'Workbook does not contain any sheets' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });

    if (!rows.length) {
      return res.status(400).json({ message: 'Worksheet is empty' });
    }

    const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
    const headerIndexMap = buildHeaderIndexMap(headerRow);
    const requiredColumns = {
      name: ['productname', 'name'],
      brand: ['brand'],
      category: ['category'],
      barcode: ['barcodenumber', 'barcode'],
      quantity: ['weight', 'quantity'],
      unit: ['unit'],
    };

    const optionalColumns = {
      subCategory: ['subcategory', 'subcat', 'sub_category'],
    };

    const missingColumns = Object.entries(requiredColumns)
      .filter(([, aliases]) => findHeaderIndex(headerIndexMap, aliases) === -1)
      .map(([field]) => field);

    if (missingColumns.length) {
      return res.status(400).json({
        message: `Missing required columns: ${missingColumns.join(', ')}`,
      });
    }

    const dataRows = rows.slice(1);
    if (!dataRows.length) {
      return res.status(400).json({ message: 'Worksheet has headers but no product rows' });
    }

    const indexes = {
      name: findHeaderIndex(headerIndexMap, requiredColumns.name),
      brand: findHeaderIndex(headerIndexMap, requiredColumns.brand),
      category: findHeaderIndex(headerIndexMap, requiredColumns.category),
      subCategory: findHeaderIndex(headerIndexMap, optionalColumns.subCategory),
      barcode: findHeaderIndex(headerIndexMap, requiredColumns.barcode),
      quantity: findHeaderIndex(headerIndexMap, requiredColumns.quantity),
      unit: findHeaderIndex(headerIndexMap, requiredColumns.unit),
    };

    const jobId = createImportJobId();
    importJobs.set(jobId, {
      id: jobId,
      status: 'queued',
      fileName: req.file.originalname || 'catalog.xlsx',
      totalRows: dataRows.length,
      processedRows: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      currentRow: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      errors: [],
      message: 'Import queued',
    });

    void runProductImportJob(jobId, dataRows, indexes);

    return res.status(202).json({
      jobId,
      status: 'queued',
      totalRows: dataRows.length,
      message: 'Import started',
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errors: [],
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Barcode already exists in the catalog' });
    }

    return res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/products/import/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = importJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ message: 'Import job not found' });
  }

  return res.json(job);
});

app.get('/api/admin/products', async (req, res) => {
  try {
    const { name = '', brand = '', category = '', subCategory = '', page = '1', limit = '100' } = req.query;
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);

    const filters = {
      barcode: { $exists: true, $ne: null },
    };

    if (String(name).trim()) {
      filters.name = {
        $regex: escapeRegex(String(name).trim()),
        $options: 'i',
      };
    }

    if (String(brand).trim()) {
      filters.brand = {
        $regex: escapeRegex(String(brand).trim()),
        $options: 'i',
      };
    }

    if (String(category).trim()) {
      filters.category = {
        $regex: escapeRegex(String(category).trim()),
        $options: 'i',
      };
    }

    if (String(subCategory).trim()) {
      filters.subCategory = {
        $regex: escapeRegex(String(subCategory).trim()),
        $options: 'i',
      };
    }

    const [products, totalCount] = await Promise.all([
      Product.find(filters)
        .sort({ updatedAt: -1 })
        .skip((normalizedPage - 1) * normalizedLimit)
        .limit(normalizedLimit)
        .lean(),
      Product.countDocuments(filters),
    ]);

    return res.json({
      products,
      totalCount,
      page: normalizedPage,
      limit: normalizedLimit,
      hasMore: normalizedPage * normalizedLimit < totalCount,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.delete('/api/admin/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await InventoryItem.deleteMany({ product: product._id });

    return res.json({ ok: true, deletedId: id });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/options', async (req, res) => {
  try {
    const { type, q = '', category } = req.query;
    const fieldMap = {
      brand: 'brand',
      category: 'category',
      subCategory: 'subCategory',
    };

    const field = fieldMap[type];
    if (!field) {
      return res.status(400).json({ message: 'type must be brand, category or subCategory' });
    }

    const filters = {
      [field]: { $exists: true, $ne: null },
    };

    const normalizedQuery = String(q).trim();
    if (normalizedQuery) {
      filters[field] = {
        $regex: escapeRegex(normalizedQuery),
        $options: 'i',
      };
    }

    if (field === 'subCategory' && category) {
      filters.category = String(category).trim();
    }

    const records = await Product.find(filters)
      .select(field)
      .sort({ [field]: 1 })
      .limit(25)
      .lean();

    const options = uniqueStrings(
      records.map((record) => record[field]).filter((value) => typeof value === 'string'),
    );

    return res.json({ options });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const { shopCode } = req.query;
    if (!shopCode) {
      return res.status(400).json({ message: 'shopCode is required' });
    }

    const items = await InventoryItem.find({ shopCode })
      .populate('product')
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get('/api/sales', async (req, res) => {
  try {
    const { shopCode } = req.query;
    if (!shopCode) {
      return res.status(400).json({ message: 'shopCode is required' });
    }

    const sales = await Sale.find({ shopCode }).sort({ soldAt: -1 }).limit(10).lean();
    return res.json({ sales });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post('/api/sales/checkout', async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { shopCode, items } = req.body;
    if (!shopCode || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'shopCode and items are required' });
    }

    let sale;

    await session.withTransaction(async () => {
      const saleItems = [];
      let totalAmount = 0;

      for (const item of items) {
        const product = await Product.findById(item.productId).session(session);
        if (!product) {
          throw new Error('One or more products no longer exist');
        }

        const inventoryItem = await InventoryItem.findOne({
          shopCode,
          product: product._id,
        }).session(session);

        if (!inventoryItem) {
          throw new Error(`${product.name} does not exist in inventory`);
        }

        if (inventoryItem.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}`);
        }

        inventoryItem.stock -= item.quantity;
        await inventoryItem.save({ session });

        const lineTotal = Number(item.unitPrice) * Number(item.quantity);
        totalAmount += lineTotal;
        saleItems.push({
          product: product._id,
          barcode: product.barcode,
          nameSnapshot: product.name,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          lineTotal,
        });
      }

      const createdSales = await Sale.create(
        [
          {
            shopCode,
            items: saleItems,
            totalAmount,
            soldAt: new Date(),
          },
        ],
        { session },
      );
      sale = createdSales[0];
    });

    return res.status(201).json({ sale });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  } finally {
    await session.endSession();
  }
});

async function start() {
  await mongoose.connect(mongoUri);
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

async function runTesseract(filePath) {
  const [result] = await visionClient.textDetection(filePath);
  const detections = result.textAnnotations || [];
  return detections[0]?.description || '';
}

async function runTesseractOnVariants(filePaths) {
  const outputs = [];
  for (const filePath of filePaths) {
    const text = await runTesseract(filePath);
    if (text.trim()) {
      outputs.push(text.trim());
    }
  }

  return mergeOcrOutputs(outputs);
}

function mergeOcrOutputs(outputs) {
  const seen = new Set();
  const lines = [];

  for (const output of outputs) {
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) {
        continue;
      }

      seen.add(key);
      lines.push(trimmed);
    }
  }

  return lines.join('\n');
}

function buildPackSize(quantity, unit) {
  if (quantity === undefined || quantity === null || quantity === '') {
    return undefined;
  }

  const normalizedQuantity = Number(quantity);
  if (Number.isNaN(normalizedQuantity) || normalizedQuantity <= 0) {
    return undefined;
  }

  const normalizedUnit = typeof unit === 'string' ? unit.trim() : '';
  return normalizedUnit ? `${normalizedQuantity}${normalizedUnit}` : String(normalizedQuantity);
}

function createImportJobId() {
  return `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function runProductImportJob(jobId, dataRows, indexes) {
  const job = importJobs.get(jobId);
  if (!job) {
    return;
  }

  job.status = 'processing';
  job.message = 'Import in progress';

  try {
    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
      const row = Array.isArray(dataRows[rowIndex]) ? dataRows[rowIndex] : [];
      const excelRowNumber = rowIndex + 2;
      job.currentRow = excelRowNumber;

      const payload = {
        barcode: normalizeBarcodeValue(readSheetCell(row, indexes.barcode)),
        name: normalizeText(readSheetCell(row, indexes.name)),
        brand: normalizeText(readSheetCell(row, indexes.brand)),
        category: normalizeText(readSheetCell(row, indexes.category)),
        subCategory: normalizeText(readSheetCell(row, indexes.subCategory)),
        unit: normalizeText(readSheetCell(row, indexes.unit)),
      };
      const quantity = Number(String(readSheetCell(row, indexes.quantity)).replace(/,/g, '').trim());

      if (
        !payload.barcode &&
        !payload.name &&
        !payload.brand &&
        !payload.category &&
        !payload.subCategory &&
        !payload.unit &&
        !String(readSheetCell(row, indexes.quantity)).trim()
      ) {
        job.processedRows += 1;
        continue;
      }

      if (!payload.barcode || !payload.name || !payload.brand || !payload.category || !payload.unit) {
        job.skippedCount += 1;
        pushImportJobError(job, {
          row: excelRowNumber,
          message: 'barcode, product name, brand, category and unit are required',
        });
        job.processedRows += 1;
        continue;
      }

      if (Number.isNaN(quantity) || quantity <= 0) {
        job.skippedCount += 1;
        pushImportJobError(job, {
          row: excelRowNumber,
          message: 'weight must be a number greater than 0',
        });
        job.processedRows += 1;
        continue;
      }

      const existingProduct = await Product.findOne({
        barcode: { $in: getBarcodeVariants(payload.barcode) },
      });

      if (existingProduct) {
        existingProduct.barcode = payload.barcode;
        existingProduct.name = payload.name;
        existingProduct.brand = payload.brand;
        existingProduct.category = payload.category;
        existingProduct.subCategory = payload.subCategory || undefined;
        existingProduct.quantity = quantity;
        existingProduct.unit = payload.unit;
        existingProduct.packSize = buildPackSize(quantity, payload.unit);
        await existingProduct.save();
        job.updatedCount += 1;
      } else {
        await Product.create({
          barcode: payload.barcode,
          name: payload.name,
          brand: payload.brand,
          category: payload.category,
          subCategory: payload.subCategory || undefined,
          quantity,
          unit: payload.unit,
          packSize: buildPackSize(quantity, payload.unit),
          sellingPrice: 0,
        });
        job.createdCount += 1;
      }

      job.processedRows += 1;
    }

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.message = `Imported ${job.createdCount + job.updatedCount} products`;
  } catch (error) {
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    job.message = error.message;
    pushImportJobError(job, {
      row: job.currentRow || 0,
      message: error.message,
    });
  }
}

function pushImportJobError(job, error) {
  if (job.errors.length < 25) {
    job.errors.push(error);
  }
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeHeaderLabel(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildHeaderIndexMap(headerRow) {
  const headerIndexMap = new Map();

  headerRow.forEach((value, index) => {
    const normalized = normalizeHeaderLabel(value);
    if (normalized && !headerIndexMap.has(normalized)) {
      headerIndexMap.set(normalized, index);
    }
  });

  return headerIndexMap;
}

function findHeaderIndex(headerIndexMap, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeaderLabel(alias);
    if (headerIndexMap.has(normalizedAlias)) {
      return headerIndexMap.get(normalizedAlias);
    }
  }

  return -1;
}

function readSheetCell(row, index) {
  if (index < 0) {
    return '';
  }

  return row[index] ?? '';
}

function normalizeBarcodeValue(value) {
  const trimmed = String(value ?? '').trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (!digitsOnly) {
    return trimmed;
  }

  if (digitsOnly.length === 13 && digitsOnly.startsWith('0')) {
    return digitsOnly.slice(1);
  }

  return digitsOnly;
}

function getBarcodeVariants(barcode) {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) {
    return [];
  }

  const variants = new Set([trimmed]);
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (digitsOnly) {
    variants.add(digitsOnly);

    if (digitsOnly.length === 12) {
      variants.add(`0${digitsOnly}`);
    }

    if (digitsOnly.length === 13 && digitsOnly.startsWith('0')) {
      variants.add(digitsOnly.slice(1));
    }
  }

  return [...variants];
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createVisionClient() {
  const keyFilename =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_CLOUD_VISION_KEY_FILE;

  if (keyFilename) {
    return new vision.ImageAnnotatorClient({ keyFilename });
  }

  return new vision.ImageAnnotatorClient();
}

start().catch((error) => {
  console.error('Failed to start API', error);
  process.exit(1);
});
