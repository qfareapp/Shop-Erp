function buildOcrSuggestion(rawText, catalog) {
  const normalizedText = normalizeWhitespace(rawText);
  const lines = extractLines(normalizedText);
  const packSize = detectPackSize(normalizedText);
  const detectedPrice = detectPrice(normalizedText);
  const category = detectCategory(normalizedText, lines, catalog);
  const detectedBrand = detectBrand(lines, catalog);
  const candidates = scoreCandidates(normalizedText, catalog, {
    packSize,
    detectedBrand,
    category,
  }).slice(0, 3);
  const bestCandidate = candidates[0];
  const strongMatch = bestCandidate && bestCandidate.score >= 9;

  const suggestion = strongMatch
    ? {
        name: buildSuggestedName(bestCandidate.product, lines, packSize),
        brand: bestCandidate.product.brand || detectedBrand,
        category: bestCandidate.product.category || category,
        packSize: bestCandidate.product.packSize || packSize,
        mrp: detectedPrice ?? bestCandidate.product.mrp ?? undefined,
        sellingPrice:
          bestCandidate.product.sellingPrice ??
          detectedPrice ??
          undefined,
      }
    : {
        name: buildName(lines, detectedBrand, packSize),
        brand: detectedBrand,
        category,
        packSize,
        mrp: detectedPrice ?? undefined,
        sellingPrice: detectedPrice ?? undefined,
      };

  return {
    rawText,
    cleanedText: normalizedText,
    confidence: strongMatch ? 'high' : candidates.length ? 'medium' : 'low',
    suggestion,
    candidates: candidates.map((entry) => ({
      productId: String(entry.product._id),
      name: entry.product.name,
      brand: entry.product.brand || '',
      category: entry.product.category || '',
      packSize: entry.product.packSize || '',
      mrp: entry.product.mrp,
      sellingPrice: entry.product.sellingPrice,
      score: entry.score,
      reasons: entry.reasons,
    })),
  };
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function extractLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
    .filter((line) => !/^[\d\s.,:/-]+$/.test(line));
}

function detectPrice(text) {
  const patterns = [
    /(?:mrp|m\.r\.p\.|rs\.?|inr)\s*[:.-]?\s*(\d+(?:\.\d{1,2})?)/i,
    /(\d+(?:\.\d{1,2})?)\s*(?:rs\.?|inr)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function detectPackSize(text) {
  const sizePatterns = [
    /(\d+(?:\.\d+)?)\s?(kg|g|mg|l|ml|litre|liter|gm)/i,
    /net\s*(?:wt|weight|vol|quantity)?\s*[:.-]?\s*(\d+(?:\.\d+)?)\s?(kg|g|mg|l|ml|litre|liter|gm)/i,
    /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s?(kg|g|mg|l|ml|litre|liter|gm)/i,
  ];

  for (const pattern of sizePatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[3]) {
        return `${match[1]}x${formatPackSize(match[2], match[3])}`;
      }
      return formatPackSize(match[1], match[2]);
    }
  }

  return '';
}

function formatPackSize(value, unit) {
  const normalizedUnit = unit.toLowerCase();
  const mappedUnit = normalizedUnit === 'gm'
    ? 'g'
    : normalizedUnit === 'liter' || normalizedUnit === 'litre'
      ? 'l'
      : normalizedUnit;
  return `${Number(value)}${mappedUnit}`;
}

function detectCategory(text, lines, catalog) {
  const categoryTokens = new Map();
  for (const product of catalog) {
    if (!product.category) {
      continue;
    }

    for (const token of tokenize(product.category)) {
      categoryTokens.set(token, product.category);
    }
  }

  const combined = [text, ...lines].join(' ').toLowerCase();
  for (const [token, category] of categoryTokens.entries()) {
    if (combined.includes(token)) {
      return category;
    }
  }

  const categoryMap = [
    { category: 'Snacks', tokens: ['chips', 'namkeen', 'snack', 'cracker'] },
    { category: 'Beverages', tokens: ['tea', 'coffee', 'drink', 'juice', 'cola'] },
    { category: 'Biscuits', tokens: ['biscuit', 'cookie'] },
    { category: 'Personal Care', tokens: ['soap', 'shampoo', 'toothpaste'] },
    { category: 'Staples', tokens: ['atta', 'rice', 'dal', 'flour', 'oil'] },
    { category: 'Dairy', tokens: ['milk', 'paneer', 'ghee', 'butter'] },
  ];

  const match = categoryMap.find((entry) =>
    entry.tokens.some((token) => combined.includes(token)),
  );

  return match ? match.category : '';
}

function detectBrand(lines, catalog) {
  const brands = Array.from(
    new Set(catalog.map((product) => product.brand).filter(Boolean)),
  );

  const loweredLines = lines.map((line) => line.toLowerCase());
  for (const brand of brands) {
    const normalizedBrand = brand.toLowerCase();
    if (loweredLines.some((line) => line.includes(normalizedBrand))) {
      return brand;
    }
  }

  for (const line of lines) {
    if (/^[A-Z0-9 &.-]{3,}$/.test(line) && !/(mrp|net|batch|mfg|exp)/i.test(line)) {
      return toTitleCase(line);
    }
  }

  return '';
}

function buildName(lines, detectedBrand, packSize) {
  const preferred = lines
    .filter((line) => !/mrp|batch|mfg|exp|net|qty|gram|ml|kg|customer care/i.test(line))
    .slice(0, 3)
    .map((line) => toTitleCase(line));

  let name = preferred.join(' ').trim() || 'Suggested Product';
  if (detectedBrand && !name.toLowerCase().includes(detectedBrand.toLowerCase())) {
    name = `${detectedBrand} ${name}`.trim();
  }
  if (packSize && !name.toLowerCase().includes(packSize.toLowerCase())) {
    name = `${name} ${packSize}`.trim();
  }

  return dedupeWords(name);
}

function buildSuggestedName(product, lines, detectedPackSize) {
  const parts = [product.name];
  const size = product.packSize || detectedPackSize;
  if (size && !product.name.toLowerCase().includes(size.toLowerCase())) {
    parts.push(size);
  }

  const merged = dedupeWords(parts.join(' ').trim());
  if (merged !== product.name) {
    return merged;
  }

  const lineHint = lines.find((line) =>
    tokenize(line).some((token) => tokenize(product.name).includes(token)),
  );
  return lineHint ? dedupeWords(`${product.name} ${toTitleCase(lineHint)}`) : product.name;
}

function scoreCandidates(text, catalog, context) {
  const tokens = tokenize(text);
  const bigrams = buildBigrams(tokens);
  const normalizedInput = normalizeForSimilarity(text);

  return catalog
    .map((product) => {
      const aliases = Array.isArray(product.aliases) ? product.aliases : [];
      const keywords = Array.isArray(product.keywords) ? product.keywords : [];
      const searchableTexts = [
        product.name,
        product.brand,
        product.category,
        product.packSize,
        ...aliases,
        ...keywords,
      ].filter(Boolean);

      const productText = searchableTexts.join(' ');
      const productTokens = tokenize(productText);
      const productBigrams = buildBigrams(productTokens);
      const overlap = productTokens.filter((token) => tokens.includes(token)).length;
      const bigramOverlap = productBigrams.filter((token) => bigrams.includes(token)).length;
      const nameSimilarity = bestSimilarity(
        normalizedInput,
        [product.name, ...aliases].filter(Boolean).map(normalizeForSimilarity),
      );

      let score = overlap + bigramOverlap * 2 + Math.round(nameSimilarity * 6);
      const reasons = [];

      if (product.brand && context.detectedBrand) {
        const brandSimilarity = similarity(
          normalizeForSimilarity(context.detectedBrand),
          normalizeForSimilarity(product.brand),
        );
        if (brandSimilarity >= 0.75) {
          score += 4;
          reasons.push(`brand:${product.brand}`);
        }
      }

      if (
        context.category &&
        product.category &&
        normalizeForSimilarity(context.category) === normalizeForSimilarity(product.category)
      ) {
        score += 2;
        reasons.push(`category:${product.category}`);
      }

      if (
        context.packSize &&
        product.packSize &&
        normalizeSize(product.packSize) === normalizeSize(context.packSize)
      ) {
        score += 5;
        reasons.push(`size:${product.packSize}`);
      }

      if (keywords.some((keyword) => tokens.includes(normalizeForSimilarity(keyword)))) {
        score += 2;
        reasons.push('keyword');
      }

      return {
        product,
        score,
        reasons,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

function bestSimilarity(input, candidates) {
  let result = 0;
  for (const candidate of candidates) {
    result = Math.max(result, similarity(input, candidate));
  }
  return result;
}

function similarity(left, right) {
  if (!left || !right) {
    return 0;
  }

  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }

  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function levenshtein(left, right) {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function buildBigrams(tokens) {
  const items = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    items.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return items;
}

function normalizeSize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function normalizeForSimilarity(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 1)
        .filter((token) => !['with', 'from', 'pack', 'free', 'best', 'extra'].includes(token)),
    ),
  );
}

function dedupeWords(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const result = [];
  for (const word of words) {
    if (!result.some((entry) => entry.toLowerCase() === word.toLowerCase())) {
      result.push(word);
    }
  }
  return result.join(' ');
}

function toTitleCase(text) {
  return String(text || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

module.exports = {
  buildOcrSuggestion,
};
