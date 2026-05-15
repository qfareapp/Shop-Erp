const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    barcode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    quantity: {
      type: Number,
      min: 0,
    },
    unit: {
      type: String,
      trim: true,
    },
    packSize: {
      type: String,
      trim: true,
    },
    aliases: {
      type: [String],
      default: [],
    },
    keywords: {
      type: [String],
      default: [],
    },
    mrp: {
      type: Number,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Product', productSchema);
