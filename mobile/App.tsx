import { StatusBar } from 'expo-status-bar';
import {
  CameraView,
  BarcodeScanningResult,
  useCameraPermissions,
} from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type ProductPayload = {
  _id: string;
  barcode?: string;
  name: string;
  brand?: string;
  category?: string;
  packSize?: string;
  mrp?: number;
  sellingPrice: number;
};

type InventoryItem = {
  _id: string;
  stock: number;
  updatedAt: string;
  product: ProductPayload;
};

type CartItem = {
  productId: string;
  barcode?: string;
  name: string;
  unitPrice: number;
  quantity: number;
};

type SaleItem = {
  nameSnapshot: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

type Sale = {
  _id: string;
  totalAmount: number;
  soldAt: string;
  items: SaleItem[];
};

type ProductFormState = {
  barcode: string;
  name: string;
  brand: string;
  category: string;
  packSize: string;
  mrp: string;
  sellingPrice: string;
  openingStock: string;
  newStock: string;
};

type OcrCandidate = {
  productId: string;
  name: string;
  brand: string;
  category: string;
  packSize: string;
  mrp?: number;
  sellingPrice?: number;
  score: number;
  reasons?: string[];
};

type OcrSuggestionResponse = {
  rawText: string;
  cleanedText: string;
  confidence: 'high' | 'medium' | 'low';
  suggestion: {
    name?: string;
    brand?: string;
    category?: string;
    packSize?: string;
    mrp?: number;
    sellingPrice?: number;
  };
  candidates: OcrCandidate[];
};

type AppTab = 'home' | 'products' | 'billing' | 'inventory' | 'profile';

const defaultApiUrl =
  process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://127.0.0.1:4000';
const defaultShopCode = 'shop-demo-001';

const emptyProductForm: ProductFormState = {
  barcode: '',
  name: '',
  brand: '',
  category: '',
  packSize: '',
  mrp: '',
  sellingPrice: '',
  openingStock: '0',
  newStock: '0',
};

function normalizeBarcodeValue(value: string) {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (!digitsOnly) {
    return trimmed;
  }

  if (digitsOnly.length === 13 && digitsOnly.startsWith('0')) {
    return digitsOnly.slice(1);
  }

  return digitsOnly;
}

export default function App() {
  const [shopCode, setShopCode] = useState(defaultShopCode);
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);
  const [scanMode, setScanMode] = useState<'product' | 'billing'>('product');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [billingBarcode, setBillingBarcode] = useState('');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [message, setMessage] = useState('Ready');
  const [lookupMissed, setLookupMissed] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrSuggestionResponse | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const totals = useMemo(() => {
    const items = cart.reduce((sum, item) => sum + item.quantity, 0);
    const amount = cart.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    return { items, amount };
  }, [cart]);

  useEffect(() => {
    void refreshDashboard();
  }, []);

  async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${defaultApiUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      ...options,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message ?? 'Request failed');
    }

    return data as T;
  }

  async function uploadProductPhoto(
    asset: ImagePicker.ImagePickerAsset,
  ): Promise<OcrSuggestionResponse> {
    const formData = new FormData();
    formData.append('image', {
      uri: asset.uri,
      name: asset.fileName ?? `product-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    } as never);

    const response = await fetch(`${defaultApiUrl}/api/products/ocr-suggest`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message ?? 'OCR request failed');
    }

    return data as OcrSuggestionResponse;
  }

  async function refreshDashboard() {
    setLoadingInventory(true);
    try {
      const [inventoryResponse, salesResponse] = await Promise.all([
        apiFetch<{ items: InventoryItem[] }>(
          `/api/inventory?shopCode=${encodeURIComponent(shopCode)}`,
        ),
        apiFetch<{ sales: Sale[] }>(
          `/api/sales?shopCode=${encodeURIComponent(shopCode)}`,
        ),
      ]);

      setInventory(inventoryResponse.items);
      setRecentSales(salesResponse.sales);
      setMessage('Inventory and sales loaded');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to sync');
    } finally {
      setLoadingInventory(false);
    }
  }

  function patchProductForm<K extends keyof ProductFormState>(
    key: K,
    value: ProductFormState[K],
  ) {
    setProductForm((current) => ({ ...current, [key]: value }));
  }

  async function lookupProductByBarcode(barcode: string) {
    return apiFetch<{ product: ProductPayload | null; inventoryItem?: InventoryItem | null }>(
      `/api/products/lookup/${encodeURIComponent(barcode)}?shopCode=${encodeURIComponent(shopCode)}`,
    );
  }

  async function saveProduct() {
    const normalizedBarcode = normalizeBarcodeValue(productForm.barcode);

    if (!productForm.name.trim()) {
      setMessage('Product name is required');
      return;
    }

    const sellingPrice = Number(productForm.sellingPrice);
    if (Number.isNaN(sellingPrice) || sellingPrice <= 0) {
      setMessage('Selling price must be greater than 0');
      return;
    }

    setSavingProduct(true);
    try {
      await apiFetch('/api/products/upsert', {
        method: 'POST',
        body: JSON.stringify({
          shopCode,
          barcode: normalizedBarcode || undefined,
          name: productForm.name.trim(),
          brand: productForm.brand.trim() || undefined,
          category: productForm.category.trim() || undefined,
          packSize: productForm.packSize.trim() || undefined,
          mrp: productForm.mrp ? Number(productForm.mrp) : undefined,
          sellingPrice,
          openingStock: productForm.openingStock ? Number(productForm.openingStock) : 0,
          newStock: productForm.newStock ? Number(productForm.newStock) : 0,
        }),
      });

      setProductForm(emptyProductForm);
      setLookupMissed(false);
      setOcrResult(null);
      setMessage('Product saved');
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save product');
    } finally {
      setSavingProduct(false);
    }
  }

  async function loadProductIntoForm() {
    const normalizedBarcode = normalizeBarcodeValue(productForm.barcode);

    if (!normalizedBarcode) {
      setMessage('Enter or scan a barcode first');
      return;
    }

    try {
      const result = await lookupProductByBarcode(normalizedBarcode);
      if (!result.product) {
        setLookupMissed(true);
        setOcrResult(null);
        setMessage('Barcode not found. Use photo OCR or enter details manually.');
        return;
      }

      setLookupMissed(false);
      setOcrResult(null);
      setProductForm({
        barcode: result.product.barcode ?? normalizedBarcode,
        name: result.product.name,
        brand: result.product.brand ?? '',
        category: result.product.category ?? '',
        packSize: result.product.packSize ?? '',
        mrp: result.product.mrp ? String(result.product.mrp) : '',
        sellingPrice: String(result.product.sellingPrice),
        openingStock: result.inventoryItem ? String(result.inventoryItem.stock) : '0',
        newStock: '0',
      });
      setMessage('Existing product loaded');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Lookup failed');
    }
  }

  async function runOcrSuggestion(source: 'camera' | 'library') {
    setOcrLoading(true);

    try {
      const permissionResult =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        setMessage(`Permission denied for ${source === 'camera' ? 'camera' : 'photo library'}`);
        return;
      }

      const pickerResult =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              allowsEditing: true,
              quality: 0.7,
            })
          : await ImagePicker.launchImageLibraryAsync({
              allowsEditing: true,
              quality: 0.7,
              mediaTypes: ['images'],
            });

      if (pickerResult.canceled || !pickerResult.assets.length) {
        setMessage('No image selected');
        return;
      }

      const result = await uploadProductPhoto(pickerResult.assets[0]);
      setOcrResult(result);
      setLookupMissed(true);
      applySuggestion(result.suggestion);
      setMessage(
        result.confidence === 'high'
          ? 'OCR suggestion applied. Review and save the product.'
          : 'OCR suggestion is weak. Choose a candidate or edit manually.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OCR failed');
    } finally {
      setOcrLoading(false);
    }
  }

  function applySuggestion(suggestion: OcrSuggestionResponse['suggestion']) {
    setProductForm((current) => ({
      ...current,
      name: suggestion.name || current.name,
      brand: suggestion.brand || current.brand,
      category: suggestion.category || current.category,
      packSize: suggestion.packSize || current.packSize,
      mrp:
        suggestion.mrp !== undefined
          ? String(suggestion.mrp)
          : current.mrp,
      sellingPrice:
        suggestion.sellingPrice !== undefined
          ? String(suggestion.sellingPrice)
          : current.sellingPrice,
    }));
  }

  function applyCandidate(candidate: OcrCandidate) {
    applySuggestion({
      name: candidate.name,
      brand: candidate.brand,
      category: candidate.category,
      packSize: candidate.packSize,
      mrp: candidate.mrp,
      sellingPrice: candidate.sellingPrice,
    });
    setMessage(`Applied candidate: ${candidate.name}`);
  }

  async function addScannedProductToCart(barcode: string) {
    setAddingToCart(true);
    try {
      const result = await lookupProductByBarcode(barcode);
      if (!result.product) {
        setMessage('Barcode not found in catalog. Add it from Products first.');
        return;
      }

      const product = result.product;

      setCart((current) => {
        const existing = current.find((item) => item.productId === product._id);
        if (!existing) {
          return [
            {
              productId: product._id,
              barcode: product.barcode,
              name: product.name,
              unitPrice: product.sellingPrice,
              quantity: 1,
            },
            ...current,
          ];
        }

        return current.map((item) =>
          item.productId === product._id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      });
      setBillingBarcode('');
      setMessage(`Added ${product.name} to cart`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to add product');
    } finally {
      setAddingToCart(false);
    }
  }

  async function addBillingBarcode() {
    const normalizedBarcode = normalizeBarcodeValue(billingBarcode);

    if (!normalizedBarcode) {
      setMessage('Enter or scan a barcode to bill');
      return;
    }

    await addScannedProductToCart(normalizedBarcode);
  }

  function updateCartQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  async function checkout() {
    if (!cart.length) {
      setMessage('Cart is empty');
      return;
    }

    setCheckingOut(true);
    try {
      await apiFetch('/api/sales/checkout', {
        method: 'POST',
        body: JSON.stringify({
          shopCode,
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        }),
      });

      setCart([]);
      setMessage('Sale recorded and stock updated');
      await refreshDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout failed');
    } finally {
      setCheckingOut(false);
    }
  }

  function openScanner(mode: 'product' | 'billing') {
    setScanMode(mode);
    setScannerOpen(true);
  }

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    setScannerOpen(false);
    const normalizedBarcode = normalizeBarcodeValue(result.data);

    if (scanMode === 'product') {
      patchProductForm('barcode', normalizedBarcode);
      setMessage(`Scanned ${normalizedBarcode}. Checking catalog...`);
      setTimeout(() => {
        void lookupScannedProduct(normalizedBarcode);
      }, 0);
      return;
    }

    setBillingBarcode(normalizedBarcode);
    await addScannedProductToCart(normalizedBarcode);
  }

  async function lookupScannedProduct(barcode: string) {
    const normalizedBarcode = normalizeBarcodeValue(barcode);

    try {
      const result = await lookupProductByBarcode(normalizedBarcode);
      if (!result.product) {
        setLookupMissed(true);
        setOcrResult(null);
        setProductForm((current) => ({
          ...current,
          barcode: normalizedBarcode,
        }));
        setMessage('Barcode not found. Capture product image for OCR suggestion.');
        return;
      }

      setLookupMissed(false);
      setOcrResult(null);
      setProductForm({
        barcode: result.product.barcode ?? normalizedBarcode,
        name: result.product.name,
        brand: result.product.brand ?? '',
        category: result.product.category ?? '',
        packSize: result.product.packSize ?? '',
        mrp: result.product.mrp ? String(result.product.mrp) : '',
        sellingPrice: String(result.product.sellingPrice),
        openingStock: result.inventoryItem ? String(result.inventoryItem.stock) : '0',
        newStock: '0',
      });
      setMessage('Existing product loaded');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Lookup failed');
    }
  }

  const canOpenScanner =
    permission?.granted || permission?.canAskAgain || permission === null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.page}>
        <View style={styles.appHeader}>
          <View>
            <Text style={styles.appHeaderTitle}>Shop ERP</Text>
          </View>
          {activeTab === 'home' ? (
            <Pressable onPress={() => void refreshDashboard()} style={styles.refreshButton}>
              <Text style={styles.refreshButtonText}>↻</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView contentContainerStyle={styles.container}>
          {activeTab === 'home' ? (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.heroEyebrow}>INVENTORY</Text>
                <Text style={styles.heroMetric}>{inventory.length}</Text>
                <Text style={styles.heroLabel}>Products in stock</Text>
                <View style={styles.heroStats}>
                  <View style={styles.heroStatCard}>
                    <Text style={styles.heroStatLabel}>Cart</Text>
                    <Text style={styles.heroStatValue}>{totals.items}</Text>
                  </View>
                  <View style={styles.heroStatCard}>
                    <Text style={styles.heroStatLabel}>Sales</Text>
                    <Text style={styles.heroStatValue}>{recentSales.length}</Text>
                  </View>
                  <View style={styles.heroStatCard}>
                    <Text style={styles.heroStatLabel}>Revenue</Text>
                    <Text style={styles.heroStatValue} numberOfLines={1} adjustsFontSizeToFit>
                      ₹{recentSales.reduce((s, sale) => s + sale.totalAmount, 0).toFixed(0)}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.sectionLabel}>Quick Actions</Text>
              <View style={styles.quickActionGrid}>
                <Pressable style={[styles.actionCard, styles.actionCardTeal]} onPress={() => setActiveTab('billing')}>
                  <Text style={styles.actionCardIcon}>🛒</Text>
                  <Text style={[styles.actionCardTitle, styles.actionCardTitleLight]}>Start Billing</Text>
                  <Text style={[styles.actionCardDesc, styles.actionCardDescLight]}>Scan & checkout</Text>
                </Pressable>
                <Pressable style={styles.actionCard} onPress={() => setActiveTab('products')}>
                  <Text style={styles.actionCardIcon}>📦</Text>
                  <Text style={styles.actionCardTitle}>Add Product</Text>
                  <Text style={styles.actionCardDesc}>Entry & restock</Text>
                </Pressable>
              </View>

              <View style={styles.card}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Recent Sales</Text>
                  {recentSales.length > 0 ? (
                    <Pressable onPress={() => setActiveTab('inventory')}>
                      <Text style={styles.seeAllText}>View all →</Text>
                    </Pressable>
                  ) : null}
                </View>
                {recentSales.length ? (
                  recentSales.slice(0, 4).map((sale) => (
                    <View key={sale._id} style={styles.listItem}>
                      <View style={styles.saleIconBadge}>
                        <Text style={styles.saleIconText}>🧾</Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>
                          {sale.items.length} item{sale.items.length > 1 ? 's' : ''}
                        </Text>
                        <Text style={styles.listMeta}>
                          {new Date(sale.soldAt).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={styles.priceTag}>₹{sale.totalAmount.toFixed(2)}</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>📭</Text>
                    <Text style={styles.emptyText}>No sales recorded yet</Text>
                    <Text style={styles.emptySubText}>Complete a billing session to see sales here</Text>
                  </View>
                )}
              </View>
            </>
          ) : null}

          {activeTab === 'products' ? (
            <>
              <View style={styles.productPreviewCard}>
                <View style={styles.productPreviewIcon}>
                  <Text style={styles.productPreviewIconText}>📦</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.productPreviewTitle} numberOfLines={1}>
                    {productForm.name || 'New Product'}
                  </Text>
                  <Text style={styles.productPreviewSub}>
                    {productForm.barcode ? `Barcode · ${productForm.barcode}` : 'No barcode scanned yet'}
                  </Text>
                </View>
                {(productForm.name || productForm.barcode) ? (
                  <Pressable
                    onPress={() => {
                      setProductForm(emptyProductForm);
                      setLookupMissed(false);
                      setOcrResult(null);
                    }}
                    style={styles.clearFormButton}
                  >
                    <Text style={styles.clearFormText}>✕ Clear</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.card}>
                <Text style={styles.formSectionHeading}>🔖 Barcode</Text>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={productForm.barcode}
                    onChangeText={(value) => patchProductForm('barcode', value)}
                    placeholder="Enter or scan barcode"
                    placeholderTextColor="#9ca3af"
                  />
                  <ActionButton
                    label="📷 Scan"
                    onPress={() =>
                      canOpenScanner
                        ? permission?.granted
                          ? openScanner('product')
                          : requestPermission().then(() => openScanner('product'))
                        : setMessage('Camera permission is not available')
                    }
                  />
                </View>
                <ActionButton label="Lookup Product" onPress={() => void loadProductIntoForm()} />
              </View>

              {lookupMissed ? (
                <View style={styles.ocrBanner}>
                  <View style={styles.ocrBannerTop}>
                    <Text style={styles.ocrBannerIcon}>🔍</Text>
                    <View style={styles.flex}>
                      <Text style={styles.ocrBannerTitle}>Barcode not found</Text>
                      <Text style={styles.ocrBannerSub}>Capture the product image to auto-fill details using OCR</Text>
                    </View>
                  </View>
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.ocrPhotoButton, ocrLoading ? styles.ocrPhotoButtonDisabled : null]}
                      onPress={() => void runOcrSuggestion('camera')}
                      disabled={ocrLoading}
                    >
                      <Text style={styles.ocrPhotoIcon}>📸</Text>
                      <Text style={styles.ocrPhotoLabel}>{ocrLoading ? 'Processing...' : 'Take Photo'}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.ocrPhotoButton, ocrLoading ? styles.ocrPhotoButtonDisabled : null]}
                      onPress={() => void runOcrSuggestion('library')}
                      disabled={ocrLoading}
                    >
                      <Text style={styles.ocrPhotoIcon}>🖼️</Text>
                      <Text style={styles.ocrPhotoLabel}>{ocrLoading ? 'Processing...' : 'Choose Photo'}</Text>
                    </Pressable>
                  </View>
                  {ocrResult ? (
                    <View style={styles.ocrResultBox}>
                      <View style={styles.ocrResultBoxHeader}>
                        <Text style={styles.ocrResultBoxTitle}>OCR Result</Text>
                        <View style={[
                          styles.ocrBadge,
                          ocrResult.confidence === 'high' ? styles.ocrBadgeHigh :
                          ocrResult.confidence === 'medium' ? styles.ocrBadgeMed :
                          styles.ocrBadgeLow,
                        ]}>
                          <Text style={styles.ocrBadgeText}>{ocrResult.confidence.toUpperCase()}</Text>
                        </View>
                      </View>
                      {ocrResult.suggestion.name ? (
                        <Text style={styles.ocrSuggestedName}>{ocrResult.suggestion.name}</Text>
                      ) : null}
                      <Text style={styles.ocrRawText} numberOfLines={3}>
                        {ocrResult.cleanedText || ocrResult.rawText}
                      </Text>
                      {ocrResult.candidates.length ? (
                        <View style={styles.candidateList}>
                          {ocrResult.candidates.map((candidate) => (
                            <Pressable
                              key={candidate.productId}
                              onPress={() => applyCandidate(candidate)}
                              style={styles.candidateCard}
                            >
                              <View style={styles.candidateRow}>
                                <View style={styles.flex}>
                                  <Text style={styles.candidateName}>{candidate.name}</Text>
                                  <Text style={styles.candidateMeta}>
                                    {[candidate.brand, candidate.packSize, candidate.category]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </Text>
                                </View>
                                <Text style={styles.candidateApplyText}>Apply →</Text>
                              </View>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.formSectionHeading}>🏷️ Product Details</Text>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Product Name <Text style={styles.formRequired}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={productForm.name}
                    onChangeText={(value) => patchProductForm('name', value)}
                    placeholder="e.g. Parle-G Original Biscuits"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Brand</Text>
                  <TextInput
                    style={styles.input}
                    value={productForm.brand}
                    onChangeText={(value) => patchProductForm('brand', value)}
                    placeholder="e.g. Parle"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Category</Text>
                  <TextInput
                    style={styles.input}
                    value={productForm.category}
                    onChangeText={(value) => patchProductForm('category', value)}
                    placeholder="e.g. Biscuits & Snacks"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.formSectionHeading}>💰 Pricing</Text>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Pack Size</Text>
                  <TextInput
                    style={styles.input}
                    value={productForm.packSize}
                    onChangeText={(value) => patchProductForm('packSize', value)}
                    placeholder="e.g. 100g, 1L, 500ml"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>MRP</Text>
                      <TextInput
                        style={styles.input}
                        value={productForm.mrp}
                        onChangeText={(value) => patchProductForm('mrp', value)}
                        placeholder="0.00"
                        keyboardType="decimal-pad"
                        placeholderTextColor="#9ca3af"
                      />
                    </View>
                  </View>
                  <View style={styles.flex}>
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Selling Price <Text style={styles.formRequired}>*</Text></Text>
                      <TextInput
                        style={styles.input}
                        value={productForm.sellingPrice}
                        onChangeText={(value) => patchProductForm('sellingPrice', value)}
                        placeholder="0.00"
                        keyboardType="decimal-pad"
                        placeholderTextColor="#9ca3af"
                      />
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.formSectionHeading}>📦 Stock</Text>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Opening Stock</Text>
                      <TextInput
                        style={styles.input}
                        value={productForm.openingStock}
                        onChangeText={(value) => patchProductForm('openingStock', value)}
                        placeholder="0"
                        keyboardType="number-pad"
                        placeholderTextColor="#9ca3af"
                      />
                    </View>
                  </View>
                  <View style={styles.flex}>
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Add Stock</Text>
                      <TextInput
                        style={styles.input}
                        value={productForm.newStock}
                        onChangeText={(value) => patchProductForm('newStock', value)}
                        placeholder="0"
                        keyboardType="number-pad"
                        placeholderTextColor="#9ca3af"
                      />
                    </View>
                  </View>
                </View>
              </View>

              <ActionButton
                label={savingProduct ? 'Saving...' : '✓ Save Product'}
                onPress={() => void saveProduct()}
                disabled={savingProduct}
              />
            </>
          ) : null}

          {activeTab === 'billing' ? (
            <>
              <View style={styles.card}>
                <Text style={styles.formSectionHeading}>🔖 Scan Item</Text>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={billingBarcode}
                    onChangeText={setBillingBarcode}
                    placeholder="Enter or scan barcode"
                    placeholderTextColor="#9ca3af"
                  />
                  <ActionButton
                    label="📷 Scan"
                    onPress={() =>
                      canOpenScanner
                        ? permission?.granted
                          ? openScanner('billing')
                          : requestPermission().then(() => openScanner('billing'))
                        : setMessage('Camera permission is not available')
                    }
                  />
                </View>
                <ActionButton
                  label={addingToCart ? 'Adding...' : 'Add to Cart'}
                  onPress={() => void addBillingBarcode()}
                  disabled={addingToCart}
                />
              </View>

              <View style={styles.card}>
                <View style={styles.cartHeader}>
                  <View style={styles.cartHeaderLeft}>
                    <Text style={styles.sectionTitle}>Cart</Text>
                    {cart.length > 0 ? (
                      <View style={styles.cartCountBadge}>
                        <Text style={styles.cartCountBadgeText}>{totals.items}</Text>
                      </View>
                    ) : null}
                  </View>
                  {cart.length > 0 ? (
                    <Pressable onPress={() => setCart([])}>
                      <Text style={styles.clearCartText}>Clear all</Text>
                    </Pressable>
                  ) : null}
                </View>

                {cart.length > 0 ? (
                  <>
                    <View style={styles.cartTotalsRow}>
                      <View style={styles.cartTotalPill}>
                        <Text style={styles.cartTotalPillLabel}>Items</Text>
                        <Text style={styles.cartTotalPillValue}>{totals.items}</Text>
                      </View>
                      <View style={[styles.cartTotalPill, styles.cartTotalPillAccent]}>
                        <Text style={[styles.cartTotalPillLabel, styles.cartTotalPillLabelAccent]}>Total</Text>
                        <Text style={[styles.cartTotalPillValue, styles.cartTotalPillValueAccent]}>
                          ₹{totals.amount.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    {cart.map((item) => (
                      <View key={item.productId} style={styles.cartItem}>
                        <View style={styles.flex}>
                          <Text style={styles.cartName}>{item.name}</Text>
                          <Text style={styles.cartMeta}>₹{item.unitPrice.toFixed(2)} × {item.quantity}</Text>
                        </View>
                        <View style={styles.cartItemRight}>
                          <Text style={styles.cartLineTotal}>₹{(item.unitPrice * item.quantity).toFixed(2)}</Text>
                          <View style={styles.counterRow}>
                            <CounterButton label="−" onPress={() => updateCartQuantity(item.productId, -1)} />
                            <Text style={styles.counterValue}>{item.quantity}</Text>
                            <CounterButton label="+" onPress={() => updateCartQuantity(item.productId, 1)} />
                          </View>
                        </View>
                      </View>
                    ))}
                  </>
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>🛒</Text>
                    <Text style={styles.emptyText}>Cart is empty</Text>
                    <Text style={styles.emptySubText}>Scan a barcode above or type it manually to add items</Text>
                  </View>
                )}
              </View>

              {cart.length > 0 ? (
                <ActionButton
                  label={checkingOut ? 'Processing...' : `✓ Checkout  ₹${totals.amount.toFixed(2)}`}
                  onPress={() => void checkout()}
                  disabled={checkingOut}
                />
              ) : null}
            </>
          ) : null}

          {activeTab === 'inventory' ? (
            <>
              <View style={styles.cartTotalsRow}>
                <View style={styles.cartTotalPill}>
                  <Text style={styles.cartTotalPillLabel}>Products</Text>
                  <Text style={styles.cartTotalPillValue}>{inventory.length}</Text>
                </View>
                <View style={styles.cartTotalPill}>
                  <Text style={styles.cartTotalPillLabel}>Units</Text>
                  <Text style={styles.cartTotalPillValue}>
                    {inventory.reduce((s, i) => s + i.stock, 0)}
                  </Text>
                </View>
                <View style={[styles.cartTotalPill, styles.cartTotalPillAccent]}>
                  <Text style={[styles.cartTotalPillLabel, styles.cartTotalPillLabelAccent]}>Revenue</Text>
                  <Text style={[styles.cartTotalPillValue, styles.cartTotalPillValueAccent]} numberOfLines={1} adjustsFontSizeToFit>
                    ₹{recentSales.reduce((s, sale) => s + sale.totalAmount, 0).toFixed(0)}
                  </Text>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Stock</Text>
                  {inventory.length > 0 ? (
                    <Text style={styles.seeAllText}>{inventory.length} products</Text>
                  ) : null}
                </View>
                {loadingInventory ? (
                  <ActivityIndicator color="#0f766e" style={{ marginVertical: 16 }} />
                ) : inventory.length ? (
                  inventory.map((item) => {
                    const isOut = item.stock === 0;
                    const isLow = item.stock > 0 && item.stock < 5;
                    return (
                      <View key={item._id} style={[styles.inventoryRow, isOut ? styles.inventoryRowOut : null]}>
                        <View style={styles.flex}>
                          <Text style={styles.listTitle}>{item.product.name}</Text>
                          <Text style={styles.listMeta}>
                            {[item.product.brand, item.product.packSize, item.product.barcode]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                        <View style={styles.inventoryRowRight}>
                          <Text style={styles.priceTag}>₹{item.product.sellingPrice.toFixed(2)}</Text>
                          <View style={[
                            styles.stockBadge,
                            isOut ? styles.stockBadgeOut : isLow ? styles.stockBadgeLow : styles.stockBadgeOk,
                          ]}>
                            <Text style={styles.stockBadgeText}>
                              {isOut ? 'Out of stock' : `${item.stock} left`}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>📦</Text>
                    <Text style={styles.emptyText}>No inventory yet</Text>
                    <Text style={styles.emptySubText}>Add products and stock from the Products tab</Text>
                  </View>
                )}
              </View>

              <View style={styles.card}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Recent Sales</Text>
                  {recentSales.length > 0 ? (
                    <Text style={styles.seeAllText}>{recentSales.length} orders</Text>
                  ) : null}
                </View>
                {recentSales.length ? (
                  recentSales.map((sale) => (
                    <View key={sale._id} style={styles.listItem}>
                      <View style={styles.saleIconBadge}>
                        <Text style={styles.saleIconText}>🧾</Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>
                          {sale.items.length} item{sale.items.length > 1 ? 's' : ''}
                        </Text>
                        <Text style={styles.listMeta}>
                          {sale.items.slice(0, 2).map((i) => i.nameSnapshot).join(', ')}
                          {sale.items.length > 2 ? ` +${sale.items.length - 2} more` : ''}
                        </Text>
                        <Text style={styles.listMeta}>{new Date(sale.soldAt).toLocaleString()}</Text>
                      </View>
                      <Text style={styles.priceTag}>₹{sale.totalAmount.toFixed(2)}</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>📭</Text>
                    <Text style={styles.emptyText}>No sales recorded yet</Text>
                    <Text style={styles.emptySubText}>Complete a billing session to see sales here</Text>
                  </View>
                )}
              </View>
            </>
          ) : null}

          {activeTab === 'profile' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Profile</Text>
              <Text style={styles.profileTitle}>Shop Workspace</Text>
              <Text style={styles.profileText}>Shop code: {shopCode}</Text>
              <Text style={styles.profileText}>Server: {defaultApiUrl}</Text>
              <Text style={styles.profileText}>Billing cart items: {totals.items}</Text>
              <Text style={styles.profileText}>Inventory records loaded: {inventory.length}</Text>
            </View>
          ) : null}

        </ScrollView>

        <View style={styles.navbar}>
          <NavTab label="Home" icon="🏠" active={activeTab === 'home'} onPress={() => setActiveTab('home')} />
          <NavTab label="Products" icon="📦" active={activeTab === 'products'} onPress={() => setActiveTab('products')} />
          <NavTab label="Billing" icon="🛒" active={activeTab === 'billing'} onPress={() => setActiveTab('billing')} prominent />
          <NavTab label="Inventory" icon="📊" active={activeTab === 'inventory'} onPress={() => setActiveTab('inventory')} />
          <NavTab label="Profile" icon="👤" active={activeTab === 'profile'} onPress={() => setActiveTab('profile')} />
        </View>
      </View>

      <Modal visible={scannerOpen} animationType="slide">
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <Text style={styles.sectionTitle}>
              {scanMode === 'product' ? 'Scan product barcode' : 'Scan item for billing'}
            </Text>
            <Pressable onPress={() => setScannerOpen(false)}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <CameraView
            style={styles.scanner}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
            }}
            onBarcodeScanned={(event) => void handleBarcodeScanned(event)}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function NavTab({
  label,
  icon,
  active,
  onPress,
  prominent,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
  prominent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.navItem,
        prominent ? styles.navItemProminent : null,
        active && !prominent ? styles.navItemActive : null,
      ]}
    >
      <Text style={[styles.navIconText, prominent ? styles.navIconProminent : null]}>
        {icon}
      </Text>
      <Text style={[styles.navText, active ? styles.navTextActive : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled ? styles.disabledButton : null]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function CounterButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.counterButton}>
      <Text style={styles.counterButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f4ed',
  },
  page: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 116,
    gap: 16,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#0f766e',
    fontWeight: '700',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#16211f',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4b5563',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 16,
    gap: 12,
    shadowColor: '#18212f',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 2,
  },
  heroCard: {
    backgroundColor: '#16211f',
    borderRadius: 24,
    padding: 18,
    gap: 10,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  heroMetric: {
    fontSize: 40,
    fontWeight: '800',
    color: '#f8fafc',
  },
  heroLabel: {
    color: '#d2ddd9',
    fontSize: 14,
  },
  heroStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  heroStatCard: {
    flex: 1,
    backgroundColor: '#22302d',
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  heroStatLabel: {
    color: '#9fb5af',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroStatValue: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#16211f',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#d4d7d2',
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: '#fbfbf8',
    color: '#16211f',
  },
  helperText: {
    flex: 1,
    fontSize: 12,
    color: '#6b7280',
  },
  helperHeadline: {
    fontSize: 13,
    fontWeight: '700',
    color: '#16211f',
  },
  ocrBlock: {
    gap: 10,
    backgroundColor: '#fff7ed',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  ocrResult: {
    gap: 6,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
  },
  ocrText: {
    fontSize: 13,
    color: '#374151',
  },
  ocrConfidence: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9a3412',
    textTransform: 'uppercase',
  },
  ocrRawText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
  },
  candidateList: {
    gap: 8,
    marginTop: 6,
  },
  candidateCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#fcfcfc',
  },
  candidateName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#16211f',
  },
  candidateMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  navbar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#dfe5df',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 4,
    gap: 4,
  },
  navItemProminent: {
    minHeight: 62,
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#99f6e4',
  },
  navIconText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#4b5563',
  },
  navIconProminent: {
    fontSize: 20,
  },
  navText: {
    fontWeight: '700',
    color: '#4b5563',
    fontSize: 10,
    textAlign: 'center',
  },
  navTextActive: {
    color: '#0f766e',
  },
  actionButton: {
    backgroundColor: '#0f766e',
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  actionText: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  cartSummary: {
    backgroundColor: '#f0fdfa',
    borderRadius: 18,
    padding: 16,
    gap: 4,
  },
  metricLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    color: '#0f766e',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#16211f',
  },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 12,
  },
  cartName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#16211f',
  },
  cartMeta: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  counterButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e7ece7',
  },
  counterButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#16211f',
  },
  counterValue: {
    minWidth: 18,
    textAlign: 'center',
    fontWeight: '700',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
    paddingVertical: 10,
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#16211f',
  },
  listMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 3,
  },
  priceTag: {
    fontWeight: '700',
    color: '#0f766e',
  },
  emptyText: {
    color: '#6b7280',
  },
  profileTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#16211f',
  },
  profileText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4b5563',
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerHeader: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeText: {
    color: '#0f766e',
    fontWeight: '700',
  },
  scanner: {
    flex: 1,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#f5f4ed',
  },
  appHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#16211f',
  },
  appHeaderSub: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e7ece7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonText: {
    fontSize: 22,
    color: '#0f766e',
    fontWeight: '700',
    lineHeight: 26,
  },
  heroEyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700',
    color: '#9fb5af',
    textTransform: 'uppercase',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 2,
  },
  quickActionGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    gap: 4,
    shadowColor: '#18212f',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
    minHeight: 110,
  },
  actionCardTeal: {
    backgroundColor: '#0f766e',
  },
  actionCardIcon: {
    fontSize: 28,
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#16211f',
    marginTop: 4,
  },
  actionCardTitleLight: {
    color: '#f8fafc',
  },
  actionCardDesc: {
    fontSize: 12,
    color: '#6b7280',
  },
  actionCardDescLight: {
    color: '#99f6e4',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f766e',
  },
  saleIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f0fdfa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleIconText: {
    fontSize: 18,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  emptyStateIcon: {
    fontSize: 36,
  },
  emptySubText: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
  },
  navItemActive: {
    backgroundColor: '#f0fdfa',
    borderRadius: 16,
  },
  productPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 16,
    shadowColor: '#18212f',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
  productPreviewIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#f0fdfa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productPreviewIconText: {
    fontSize: 24,
  },
  productPreviewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#16211f',
  },
  productPreviewSub: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  clearFormButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#fee2e2',
  },
  clearFormText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ef4444',
  },
  formSectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 4,
  },
  formGroup: {
    gap: 6,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  formRequired: {
    color: '#ef4444',
    fontWeight: '700',
  },
  ocrBanner: {
    backgroundColor: '#fff7ed',
    borderRadius: 20,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  ocrBannerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  ocrBannerIcon: {
    fontSize: 22,
  },
  ocrBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400e',
  },
  ocrBannerSub: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
  },
  ocrPhotoButton: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  ocrPhotoButtonDisabled: {
    opacity: 0.6,
  },
  ocrPhotoIcon: {
    fontSize: 22,
  },
  ocrPhotoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
  },
  ocrResultBox: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  ocrResultBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ocrResultBoxTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#16211f',
  },
  ocrBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ocrBadgeHigh: {
    backgroundColor: '#dcfce7',
  },
  ocrBadgeMed: {
    backgroundColor: '#fef9c3',
  },
  ocrBadgeLow: {
    backgroundColor: '#fee2e2',
  },
  ocrBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#374151',
  },
  ocrSuggestedName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  candidateApplyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f766e',
  },
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cartHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cartCountBadge: {
    backgroundColor: '#0f766e',
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  cartCountBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  clearCartText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
  },
  cartTotalsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cartTotalPill: {
    flex: 1,
    backgroundColor: '#f0fdfa',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  cartTotalPillAccent: {
    backgroundColor: '#0f766e',
  },
  cartTotalPillLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#0f766e',
    fontWeight: '600',
  },
  cartTotalPillLabelAccent: {
    color: '#99f6e4',
  },
  cartTotalPillValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#16211f',
  },
  cartTotalPillValueAccent: {
    color: '#f8fafc',
  },
  cartItemRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  cartLineTotal: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f766e',
  },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
    paddingVertical: 12,
  },
  inventoryRowOut: {
    opacity: 0.45,
  },
  inventoryRowRight: {
    alignItems: 'flex-end',
    gap: 5,
  },
  stockBadge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  stockBadgeOk: {
    backgroundColor: '#dcfce7',
  },
  stockBadgeLow: {
    backgroundColor: '#fef9c3',
  },
  stockBadgeOut: {
    backgroundColor: '#fee2e2',
  },
  stockBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
});
