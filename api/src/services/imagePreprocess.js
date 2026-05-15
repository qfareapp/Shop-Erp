const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

async function createOcrImageVariants(inputBuffer) {
  const image = sharp(inputBuffer, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 1200;
  const height = metadata.height || 1200;

  const variants = [
    {
      name: 'full',
      pipeline: image
        .clone()
        .resize({ width: 1600, withoutEnlargement: false })
        .grayscale()
        .normalize(),
    },
    {
      name: 'threshold',
      pipeline: image
        .clone()
        .resize({ width: 1800, withoutEnlargement: false })
        .grayscale()
        .normalize()
        .sharpen()
        .threshold(170),
    },
    {
      name: 'label-center',
      pipeline: image
        .clone()
        .extract(centerLabelCrop(width, height))
        .resize({ width: 1600, withoutEnlargement: false })
        .grayscale()
        .normalize()
        .sharpen(),
    },
    {
      name: 'label-upper',
      pipeline: image
        .clone()
        .extract(upperLabelCrop(width, height))
        .resize({ width: 1600, withoutEnlargement: false })
        .grayscale()
        .normalize()
        .threshold(165),
    },
  ];

  return Promise.all(
    variants.map(async (variant) => {
      const outputPath = path.join(
        os.tmpdir(),
        `shop-erp-ocr-${variant.name}-${crypto.randomUUID()}.png`,
      );
      await variant.pipeline.png().toFile(outputPath);
      return outputPath;
    }),
  );
}

function centerLabelCrop(width, height) {
  const cropWidth = Math.max(Math.floor(width * 0.78), 200);
  const cropHeight = Math.max(Math.floor(height * 0.55), 200);
  return {
    left: Math.max(Math.floor((width - cropWidth) / 2), 0),
    top: Math.max(Math.floor(height * 0.18), 0),
    width: Math.min(cropWidth, width),
    height: Math.min(cropHeight, height - Math.max(Math.floor(height * 0.18), 0)),
  };
}

function upperLabelCrop(width, height) {
  const cropWidth = Math.max(Math.floor(width * 0.82), 200);
  const cropHeight = Math.max(Math.floor(height * 0.42), 200);
  return {
    left: Math.max(Math.floor((width - cropWidth) / 2), 0),
    top: Math.max(Math.floor(height * 0.08), 0),
    width: Math.min(cropWidth, width),
    height: Math.min(cropHeight, height - Math.max(Math.floor(height * 0.08), 0)),
  };
}

async function cleanupFiles(filePaths) {
  await Promise.all(filePaths.map((filePath) => fs.unlink(filePath).catch(() => {})));
}

module.exports = {
  cleanupFiles,
  createOcrImageVariants,
};
