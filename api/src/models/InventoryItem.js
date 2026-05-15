const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    shopCode: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

inventoryItemSchema.index({ shopCode: 1, product: 1 }, { unique: true });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
