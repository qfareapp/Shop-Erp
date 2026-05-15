import { StatusBar } from 'expo-status-bar';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  TouchableWithoutFeedback,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type ProductForm = {
  barcode: string;
  name: string;
  brand: string;
  quantity: string;
  unit: string;
  category: string;
  subCategory: string;
};

type ProductRecord = {
  _id: string;
  barcode?: string;
  name: string;
  brand?: string;
  quantity?: number;
  unit?: string;
  category?: string;
  subCategory?: string;
  createdAt?: string;
  updatedAt?: string;
};

type LookupField = 'brand' | 'category' | 'subCategory';

type LookupSuggestions = Record<LookupField, string[]>;
type TabKey = 'home' | 'scan' | 'masterlist' | 'profile';
type MasterlistFilters = {
  name: string;
  brand: string;
  category: string;
  subCategory: string;
};

type PendingDuplicateAlert = {
  barcode: string;
  productName: string;
};

type BulkImportResponse = {
  jobId: string;
  status: 'queued' | 'processing';
  totalRows: number;
  message: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
};

type BulkImportJobStatus = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  message: string;
  fileName: string;
  totalRows: number;
  processedRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  currentRow: number;
  startedAt: string;
  completedAt: string | null;
  errors: Array<{
    row: number;
    message: string;
  }>;
};

const localApiUrl = 'http://192.168.16.20:4000';
const renderApiUrl = 'https://shop-erp-4iwu.onrender.com';
const defaultApiUrl =
  process.env.EXPO_PUBLIC_API_URL?.trim() || (__DEV__ ? localApiUrl : renderApiUrl);
const unitOptions = [
  'mg',
  'g',
  'kg',
  'ml',
  'L',
  'cm',
  'm',
  'mm',
  'sqft',
  'piece',
  'pcs',
  'packet',
  'box',
  'bottle',
  'can',
  'jar',
  'tube',
  'pouch',
  'sachet',
  'dozen',
  'pair',
  'set',
  'roll',
  'sheet',
  'carton',
  'tray',
];

const emptyForm: ProductForm = {
  barcode: '',
  name: '',
  brand: '',
  quantity: '',
  unit: '',
  category: '',
  subCategory: '',
};

const emptyMasterlistFilters: MasterlistFilters = {
  name: '',
  brand: '',
  category: '',
  subCategory: '',
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
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [message, setMessage] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [saving, setSaving] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [masterlistProducts, setMasterlistProducts] = useState<ProductRecord[]>([]);
  const [loadingMasterlist, setLoadingMasterlist] = useState(false);
  const [loadingMoreMasterlist, setLoadingMoreMasterlist] = useState(false);
  const [masterlistPage, setMasterlistPage] = useState(1);
  const [masterlistHasMore, setMasterlistHasMore] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [recentProducts, setRecentProducts] = useState<ProductRecord[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [masterlistFilters, setMasterlistFilters] =
    useState<MasterlistFilters>(emptyMasterlistFilters);
  const [suggestions, setSuggestions] = useState<LookupSuggestions>({
    brand: [],
    category: [],
    subCategory: [],
  });
  const [activeLookup, setActiveLookup] = useState<LookupField | null>(null);
  const [loadingLookup, setLoadingLookup] = useState<LookupField | null>(null);
  const [masterlistPickerField, setMasterlistPickerField] = useState<LookupField | null>(null);
  const [pendingDuplicateAlert, setPendingDuplicateAlert] =
    useState<PendingDuplicateAlert | null>(null);
  const [importingSheet, setImportingSheet] = useState(false);
  const [importJob, setImportJob] = useState<BulkImportJobStatus | null>(null);

  function resetProductEntryForm() {
    setForm(emptyForm);
    setSuggestions({
      brand: [],
      category: [],
      subCategory: [],
    });
    setActiveLookup(null);
    setLoadingLookup(null);
    setUnitPickerOpen(false);
    setScannerOpen(false);
    setPendingDuplicateAlert(null);
  }

  function updateField<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateMasterlistFilter<K extends keyof MasterlistFilters>(
    key: K,
    value: MasterlistFilters[K],
  ) {
    setMasterlistFilters((current) => ({ ...current, [key]: value }));
  }

  async function openMasterlistPicker(field: LookupField) {
    if (field === 'subCategory' && masterlistFilters.category.trim()) {
      setSuggestions((current) => ({
        ...current,
        subCategory: [],
      }));
    }

    setMasterlistPickerField(field);
    setLoadingLookup(field);
    try {
      const params = new URLSearchParams();
      params.set('type', field);
      if (field === 'subCategory' && masterlistFilters.category.trim()) {
        params.set('category', masterlistFilters.category.trim());
      }

      const response = await apiFetch<{ options: string[] }>(
        `/api/admin/options?${params.toString()}`,
      );

      setSuggestions((current) => ({
        ...current,
        [field]: response.options,
      }));
    } catch {
      setSuggestions((current) => ({
        ...current,
        [field]: [],
      }));
    } finally {
      setLoadingLookup((current) => (current === field ? null : current));
    }
  }

  function applyMasterlistFilter(field: LookupField, value: string) {
    setMasterlistFilters((current) => ({
      ...current,
      [field]: value,
      ...(field === 'category' ? { subCategory: '' } : {}),
    }));
    setMasterlistPickerField(null);
  }

  async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const isFormData = options?.body instanceof FormData;
    const response = await fetch(`${defaultApiUrl}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options?.headers ?? {}),
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message ?? 'Request failed');
    }

    return data as T;
  }

  async function loadSuggestions(field: LookupField, value: string) {
    const params = new URLSearchParams();
    params.set('type', field);

    const trimmedValue = value.trim();
    if (trimmedValue) {
      params.set('q', trimmedValue);
    }

    if (field === 'subCategory' && form.category.trim()) {
      params.set('category', form.category.trim());
    }

    setLoadingLookup(field);
    try {
      const response = await apiFetch<{ options: string[] }>(
        `/api/admin/options?${params.toString()}`,
      );

      setSuggestions((current) => ({
        ...current,
        [field]: response.options,
      }));
    } catch {
      setSuggestions((current) => ({
        ...current,
        [field]: [],
      }));
    } finally {
      setLoadingLookup((current) => (current === field ? null : current));
    }
  }

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      const response = await apiFetch<{ products: ProductRecord[]; totalCount: number }>(
        '/api/admin/products?limit=100',
      );
      setRecentProducts(response.products);
      setTotalProducts(response.totalCount);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load products');
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadMasterlistProducts({
    page,
    append,
  }: {
    page: number;
    append: boolean;
  }) {
    if (append) {
      setLoadingMoreMasterlist(true);
    } else {
      setLoadingMasterlist(true);
    }

    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '100');

      if (masterlistFilters.name.trim()) {
        params.set('name', masterlistFilters.name.trim());
      }

      if (masterlistFilters.brand.trim()) {
        params.set('brand', masterlistFilters.brand.trim());
      }

      if (masterlistFilters.category.trim()) {
        params.set('category', masterlistFilters.category.trim());
      }

      if (masterlistFilters.subCategory.trim()) {
        params.set('subCategory', masterlistFilters.subCategory.trim());
      }

      const response = await apiFetch<{
        products: ProductRecord[];
        totalCount: number;
        page: number;
        hasMore: boolean;
      }>(`/api/admin/products?${params.toString()}`);

      setMasterlistProducts((current) =>
        append ? [...current, ...response.products] : response.products,
      );
      setMasterlistPage(response.page);
      setMasterlistHasMore(response.hasMore);
      setTotalProducts(response.totalCount);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load masterlist');
    } finally {
      if (append) {
        setLoadingMoreMasterlist(false);
      } else {
        setLoadingMasterlist(false);
      }
    }
  }

  async function refreshProducts() {
    setRefreshing(true);
    try {
      await loadProducts();
      await loadMasterlistProducts({ page: 1, append: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function lookupProductByBarcode(barcode: string) {
    return apiFetch<{ product: ProductRecord | null }>(
      `/api/products/lookup/${encodeURIComponent(barcode)}`,
    );
  }

  async function deleteProduct(product: ProductRecord) {
    try {
      await apiFetch(`/api/admin/products/${product._id}`, {
        method: 'DELETE',
      });
      setDeleteTargetId(null);
      await loadProducts();
      await loadMasterlistProducts({ page: 1, append: false });
      setMessage(`Deleted ${product.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete product');
    }
  }

  function confirmDelete(product: ProductRecord) {
    Alert.alert(
      'Delete product',
      `Delete ${product.name} from the database?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteProduct(product);
          },
        },
      ],
    );
  }

  function handleLookupChange(field: LookupField, value: string) {
    updateField(field, value);
    setActiveLookup(field);
    void loadSuggestions(field, value);
  }

  function selectSuggestion(field: LookupField, value: string) {
    updateField(field, value);
    setSuggestions((current) => ({
      ...current,
      [field]: [],
    }));
    setActiveLookup(null);
  }

  async function saveProduct() {
    const normalizedBarcode = normalizeBarcodeValue(form.barcode);

    if (!normalizedBarcode) {
      setMessage('Barcode is required');
      return;
    }

    if (!form.name.trim() || !form.brand.trim() || !form.unit.trim() || !form.category.trim()) {
      setMessage('Fill in all required product fields');
      return;
    }

    const numericQuantity = Number(form.quantity);
    if (Number.isNaN(numericQuantity) || numericQuantity <= 0) {
      setMessage('Quantity must be greater than 0');
      return;
    }

    setSaving(true);
    try {
      const response = await apiFetch<{ product: ProductRecord }>('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          barcode: normalizedBarcode,
          name: form.name.trim(),
          brand: form.brand.trim(),
          quantity: numericQuantity,
          unit: form.unit.trim(),
          category: form.category.trim(),
          subCategory: form.subCategory.trim() || undefined,
        }),
      });

      await loadProducts();
      await loadMasterlistProducts({ page: 1, append: false });
      resetProductEntryForm();
      setMessage(`Saved ${response.product.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save product');
    } finally {
      setSaving(false);
    }
  }

  async function importProductSheet() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets.length) {
        return;
      }

      const file = result.assets[0];
      setImportingSheet(true);
      setMessage(`Uploading ${file.name}...`);

      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name || 'catalog.xlsx',
        type:
          file.mimeType ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } as never);

      const response = await apiFetch<BulkImportResponse>('/api/admin/products/import', {
        method: 'POST',
        body: formData,
      });

      await loadProducts();

      const errorSummary = response.errors
        .slice(0, 3)
        .map((error) => `Row ${error.row}: ${error.message}`)
        .join(' | ');

      setMessage(
        [
          response.message,
          `Created ${response.createdCount}`,
          `Updated ${response.updatedCount}`,
          `Skipped ${response.skippedCount}`,
          errorSummary || null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to import Excel sheet');
    } finally {
      setImportingSheet(false);
    }
  }

  async function startImportJob() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets.length) {
        return;
      }

      const file = result.assets[0];
      setImportingSheet(true);
      setMessage(`Uploading ${file.name}...`);

      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name || 'catalog.xlsx',
        type:
          file.mimeType ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } as never);

      const response = await apiFetch<BulkImportResponse>('/api/admin/products/import', {
        method: 'POST',
        body: formData,
      });

      setImportJob({
        id: response.jobId,
        status: response.status,
        fileName: file.name || 'catalog.xlsx',
        totalRows: response.totalRows,
        processedRows: 0,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        currentRow: 0,
        startedAt: new Date().toISOString(),
        completedAt: null,
        errors: [],
        message: response.message,
      });
      setMessage(`Import started for ${file.name}`);
    } catch (error) {
      setImportingSheet(false);
      setMessage(error instanceof Error ? error.message : 'Failed to import Excel sheet');
    }
  }

  async function pollImportJob(jobId: string) {
    const response = await apiFetch<BulkImportJobStatus>(`/api/admin/products/import/${jobId}`);
    setImportJob(response);

    if (response.status === 'completed') {
      setImportingSheet(false);
      await loadProducts();

      const errorSummary = response.errors
        .slice(0, 3)
        .map((error) => `Row ${error.row}: ${error.message}`)
        .join(' | ');

      setMessage(
        [
          response.message,
          `Created ${response.createdCount}`,
          `Updated ${response.updatedCount}`,
          `Skipped ${response.skippedCount}`,
          errorSummary || null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    }

    if (response.status === 'failed') {
      setImportingSheet(false);
      setMessage(response.message || 'Import failed');
    }
  }

  async function handleScannedBarcode(barcode: string) {
    const normalizedBarcode = normalizeBarcodeValue(barcode);
    updateField('barcode', normalizedBarcode);

    try {
      const result = await lookupProductByBarcode(normalizedBarcode);
      if (!result.product) {
        setMessage(`Scanned barcode ${normalizedBarcode}`);
        return;
      }

      setForm((current) => ({
        ...current,
        barcode: result.product?.barcode ?? normalizedBarcode,
        name: result.product?.name ?? current.name,
        brand: result.product?.brand ?? current.brand,
        quantity:
          result.product?.quantity !== undefined ? String(result.product.quantity) : current.quantity,
        unit: result.product?.unit ?? current.unit,
        category: result.product?.category ?? current.category,
        subCategory: result.product?.subCategory ?? current.subCategory,
      }));
      setPendingDuplicateAlert({
        barcode: normalizedBarcode,
        productName: result.product?.name || 'This product',
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Barcode lookup failed');
    }
  }

  async function openScanner() {
    if (permission?.granted) {
      setScannerOpen(true);
      return;
    }

    const result = await requestPermission();
    if (result.granted) {
      setScannerOpen(true);
      return;
    }

    setMessage('Camera permission is required to scan barcodes');
  }

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    setScannerOpen(false);
    void handleScannedBarcode(result.data);
  }

  useEffect(() => {
    void loadProducts();
    void loadMasterlistProducts({ page: 1, append: false });
  }, []);

  useEffect(() => {
    void loadMasterlistProducts({ page: 1, append: false });
  }, [
    masterlistFilters.name,
    masterlistFilters.brand,
    masterlistFilters.category,
    masterlistFilters.subCategory,
  ]);

  useEffect(() => {
    if (scannerOpen || !pendingDuplicateAlert) {
      return;
    }

    Alert.alert(
      'Product already exists',
      `${pendingDuplicateAlert.productName} is already in the database for barcode ${pendingDuplicateAlert.barcode}.`,
      [
        {
          text: 'OK',
          onPress: () => setPendingDuplicateAlert(null),
        },
      ],
    );
  }, [scannerOpen, pendingDuplicateAlert]);

  useEffect(() => {
    if (!importJob || (importJob.status !== 'queued' && importJob.status !== 'processing')) {
      return;
    }

    const intervalId = setInterval(() => {
      void pollImportJob(importJob.id);
    }, 1200);

    void pollImportJob(importJob.id);

    return () => clearInterval(intervalId);
  }, [importJob?.id, importJob?.status]);

  const importProgress =
    importJob && importJob.totalRows > 0
      ? Math.min(importJob.processedRows / importJob.totalRows, 1)
      : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <TouchableWithoutFeedback onPress={() => setDeleteTargetId(null)}>
          <View style={styles.page}>
            <View style={styles.appHeader}>
              <View>
                <Text style={styles.appHeaderTitle}>Product Master</Text>
                <Text style={styles.appHeaderSub}>Admin workspace</Text>
              </View>
              {activeTab === 'home' ? (
                <Pressable onPress={() => void loadProducts()} style={styles.refreshButton}>
                  <Text style={styles.refreshButtonText}>↻</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              contentContainerStyle={styles.container}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void refreshProducts()}
                  tintColor="#1d6b57"
                  colors={['#1d6b57']}
                />
              }
            >

          {activeTab === 'home' ? (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.heroEyebrow}>CATALOG</Text>
                <Text style={styles.heroMetric}>{totalProducts}</Text>
                <Text style={styles.heroLabel}>Products in master catalog</Text>
                <View style={styles.heroStats}>
                  <View style={styles.heroStatCard}>
                    <Text style={styles.heroStatLabel}>Brands</Text>
                    <Text style={styles.heroStatValue}>
                      {new Set(recentProducts.map((p) => p.brand).filter(Boolean)).size}
                    </Text>
                  </View>
                  <View style={styles.heroStatCard}>
                    <Text style={styles.heroStatLabel}>Categories</Text>
                    <Text style={styles.heroStatValue}>
                      {new Set(recentProducts.map((p) => p.category).filter(Boolean)).size}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.sectionLabel}>Quick Actions</Text>
              <View style={styles.quickActionGrid}>
                <Pressable
                  style={[styles.actionCard, styles.actionCardGreen]}
                  onPress={() => { setActiveTab('scan'); void openScanner(); }}
                >
                  <Text style={styles.actionCardIcon}>📷</Text>
                  <Text style={[styles.actionCardTitle, styles.actionCardTitleLight]}>Scan & Save</Text>
                  <Text style={[styles.actionCardDesc, styles.actionCardDescLight]}>Add a new product</Text>
                </Pressable>
                <Pressable
                  style={styles.actionCard}
                  onPress={() => setActiveTab('masterlist')}
                >
                  <Text style={styles.actionCardIcon}>📋</Text>
                  <Text style={styles.actionCardTitle}>Masterlist</Text>
                  <Text style={styles.actionCardDesc}>Browse catalog</Text>
                </Pressable>
              </View>

              <View style={styles.card}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Recent Activity</Text>
                  {recentProducts.length > 0 ? (
                    <Pressable onPress={() => setActiveTab('masterlist')}>
                      <Text style={styles.seeAllText}>View all →</Text>
                    </Pressable>
                  ) : null}
                </View>
                {loadingProducts ? (
                  <ActivityIndicator color="#1d6b57" style={{ marginVertical: 16 }} />
                ) : recentProducts.length ? (
                  recentProducts.slice(0, 4).map((product) => (
                    <View key={product._id} style={styles.activityRow}>
                      <View style={styles.activityIconBadge}>
                        <Text style={styles.activityIconText}>📦</Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productMeta}>
                          {[
                            product.brand,
                            product.quantity && product.unit
                              ? `${product.quantity}${product.unit}`
                              : null,
                            product.category,
                            product.subCategory,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>📭</Text>
                    <Text style={styles.emptyText}>No products saved yet</Text>
                    <Text style={styles.emptySubText}>Use Scan & Save to add your first product</Text>
                  </View>
                )}
              </View>
            </>
          ) : null}

          {activeTab === 'scan' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Scan And Save</Text>
              <View style={styles.importPanel}>
                <Text style={styles.importTitle}>Bulk import from Excel</Text>
                <Text style={styles.importText}>
                  Upload columns: Product Name, Brand, Category, Sub Category, Barcode Number,
                  Weight, Unit.
                </Text>
                {importJob ? (
                  <View style={styles.importStatusCard}>
                    <View style={styles.importStatusHeader}>
                      <Text style={styles.importStatusLabel}>
                        {importJob.status === 'completed'
                          ? 'Import completed'
                          : importJob.status === 'failed'
                            ? 'Import failed'
                            : 'Import in progress'}
                      </Text>
                      <Text style={styles.importStatusValue}>
                        {importJob.processedRows}/{importJob.totalRows}
                      </Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.max(importProgress * 100, importJob ? 4 : 0)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.importStatusText}>
                      {importJob.status === 'queued'
                        ? 'Waiting to start import'
                        : importJob.status === 'processing'
                          ? `Processing row ${importJob.currentRow || 1}`
                          : importJob.message}
                    </Text>
                    <Text style={styles.importStatusMeta}>
                      {`Created ${importJob.createdCount} · Updated ${importJob.updatedCount} · Skipped ${importJob.skippedCount}`}
                    </Text>
                  </View>
                ) : null}
                <ActionButton
                  label={importingSheet ? 'Importing...' : 'Attach Excel Sheet'}
                  onPress={() => void startImportJob()}
                  disabled={importingSheet || saving}
                />
              </View>
              <View style={styles.scanRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={form.barcode}
                  onChangeText={(value) => updateField('barcode', value)}
                  placeholder="Barcode"
                />
                <ActionButton label="Scan" onPress={() => void openScanner()} />
              </View>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(value) => updateField('name', value)}
                placeholder="Product name"
              />
              <View style={styles.lookupBlock}>
                <TextInput
                  style={styles.input}
                  value={form.brand}
                  onChangeText={(value) => handleLookupChange('brand', value)}
                  onFocus={() => {
                    setActiveLookup('brand');
                    void loadSuggestions('brand', form.brand);
                  }}
                  placeholder="Brand"
                />
                <LookupSuggestionList
                  visible={activeLookup === 'brand'}
                  loading={loadingLookup === 'brand'}
                  options={suggestions.brand}
                  value={form.brand}
                  emptyText="No saved brands match. Keep typing to save a new brand."
                  onSelect={(value) => selectSuggestion('brand', value)}
                />
              </View>
              <View style={styles.scanRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={form.quantity}
                  onChangeText={(value) => updateField('quantity', value)}
                  placeholder="Quantity"
                  keyboardType="decimal-pad"
                />
                <Pressable
                  onPress={() => setUnitPickerOpen(true)}
                  style={[styles.input, styles.unitInput, styles.dropdownTrigger]}
                >
                  <Text style={form.unit ? styles.dropdownValue : styles.dropdownPlaceholder}>
                    {form.unit || 'Unit'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.lookupBlock}>
                <TextInput
                  style={styles.input}
                  value={form.category}
                  onChangeText={(value) => {
                    handleLookupChange('category', value);
                    if (form.subCategory) {
                      updateField('subCategory', '');
                    }
                    setSuggestions((current) => ({
                      ...current,
                      subCategory: [],
                    }));
                  }}
                  onFocus={() => {
                    setActiveLookup('category');
                    void loadSuggestions('category', form.category);
                  }}
                  placeholder="Category"
                />
                <LookupSuggestionList
                  visible={activeLookup === 'category'}
                  loading={loadingLookup === 'category'}
                  options={suggestions.category}
                  value={form.category}
                  emptyText="No saved categories match. Keep typing to save a new category."
                  onSelect={(value) => selectSuggestion('category', value)}
                />
              </View>
              <View style={styles.lookupBlock}>
                <TextInput
                  style={styles.input}
                  value={form.subCategory}
                  onChangeText={(value) => handleLookupChange('subCategory', value)}
                  onFocus={() => {
                    setActiveLookup('subCategory');
                    void loadSuggestions('subCategory', form.subCategory);
                  }}
                  placeholder="Sub-category"
                />
                <LookupSuggestionList
                  visible={activeLookup === 'subCategory'}
                  loading={loadingLookup === 'subCategory'}
                  options={suggestions.subCategory}
                  value={form.subCategory}
                  emptyText="No saved sub-categories match. Keep typing to save a new sub-category."
                  onSelect={(value) => selectSuggestion('subCategory', value)}
                />
              </View>
              <ActionButton
                label={saving ? 'Saving...' : 'Save Product'}
                onPress={() => void saveProduct()}
                disabled={saving}
              />
            </View>
          ) : null}

          {activeTab === 'masterlist' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Masterlist</Text>
              <TextInput
                style={styles.input}
                value={masterlistFilters.name}
                onChangeText={(value) => updateMasterlistFilter('name', value)}
                placeholder="Search by product name"
              />
              <View style={styles.filterRow}>
                <Pressable
                  onPress={() => void openMasterlistPicker('brand')}
                  style={[styles.filterChip, styles.flex]}
                >
                  <Text
                    style={
                      masterlistFilters.brand ? styles.filterChipText : styles.filterChipPlaceholder
                    }
                    numberOfLines={1}
                  >
                    {masterlistFilters.brand || 'Brand'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void openMasterlistPicker('category')}
                  style={[styles.filterChip, styles.flex]}
                >
                  <Text
                    style={
                      masterlistFilters.category
                        ? styles.filterChipText
                        : styles.filterChipPlaceholder
                    }
                    numberOfLines={1}
                  >
                    {masterlistFilters.category || 'Category'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void openMasterlistPicker('subCategory')}
                  style={[styles.filterChip, styles.flex]}
                >
                  <Text
                    style={
                      masterlistFilters.subCategory
                        ? styles.filterChipText
                        : styles.filterChipPlaceholder
                    }
                    numberOfLines={1}
                  >
                    {masterlistFilters.subCategory || 'Sub-category'}
                  </Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => setMasterlistFilters(emptyMasterlistFilters)}
                style={styles.clearFiltersButton}
              >
                <Text style={styles.clearFiltersText}>Clear filters</Text>
              </Pressable>
              {loadingMasterlist ? (
                <ActivityIndicator color="#0b5d4b" />
              ) : saving && !masterlistProducts.length ? (
                <ActivityIndicator color="#0b5d4b" />
              ) : masterlistProducts.length ? (
                masterlistProducts.map((product) => (
                  <Pressable
                    key={product._id}
                    onLongPress={() =>
                      setDeleteTargetId((current) =>
                        current === product._id ? null : product._id,
                      )
                    }
                    style={styles.productRow}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.productName}>{product.name}</Text>
                      <Text style={styles.productMeta}>
                        {[
                          product.brand,
                          product.barcode,
                          product.quantity && product.unit
                            ? `${product.quantity}${product.unit}`
                            : null,
                          product.category,
                          product.subCategory,
                        ]
                          .filter(Boolean)
                          .join(' | ')}
                      </Text>
                    </View>
                    {deleteTargetId === product._id ? (
                      <Pressable
                        onPress={() => confirmDelete(product)}
                        style={styles.deleteButton}
                      >
                        <Text style={styles.deleteButtonText}>Delete</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptyText}>No products match the selected filters.</Text>
              )}
              {masterlistHasMore ? (
                <Pressable
                  onPress={() =>
                    !loadingMoreMasterlist
                      ? void loadMasterlistProducts({ page: masterlistPage + 1, append: true })
                      : undefined
                  }
                  style={[styles.loadMoreButton, loadingMoreMasterlist ? styles.buttonDisabled : null]}
                >
                  <Text style={styles.loadMoreButtonText}>
                    {loadingMoreMasterlist ? 'Loading...' : 'Load more'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {activeTab === 'profile' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Profile</Text>
              <Text style={styles.profileTitle}>Admin Workspace</Text>
              <Text style={styles.profileText}>Server: {defaultApiUrl}</Text>
              <Text style={styles.profileText}>Camera barcode scanner enabled</Text>
              <Text style={styles.profileText}>
                Catalog autocomplete enabled for brand, category, and sub-category
              </Text>
            </View>
          ) : null}

              {message ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerText}>{message}</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.navbar}>
              <NavTab label="Home" icon="🏠" active={activeTab === 'home'} onPress={() => setActiveTab('home')} />
              <NavTab label="Scan" icon="📷" active={activeTab === 'scan'} onPress={() => setActiveTab('scan')} />
              <NavTab label="Masterlist" icon="📋" active={activeTab === 'masterlist'} onPress={() => setActiveTab('masterlist')} />
              <NavTab label="Profile" icon="👤" active={activeTab === 'profile'} onPress={() => setActiveTab('profile')} />
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <Modal visible={scannerOpen} animationType="slide">
        <SafeAreaView style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.sectionTitle}>Scan Product Barcode</Text>
            <Pressable onPress={() => setScannerOpen(false)}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
            }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={unitPickerOpen} animationType="slide" transparent>
        <View style={styles.dropdownBackdrop}>
          <SafeAreaView style={styles.dropdownSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>Select Unit</Text>
              <Pressable onPress={() => setUnitPickerOpen(false)}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
            <FlatList
              data={unitOptions}
              keyExtractor={(item) => item}
              contentContainerStyle={styles.dropdownList}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    updateField('unit', item);
                    setUnitPickerOpen(false);
                  }}
                  style={[
                    styles.dropdownOption,
                    form.unit === item ? styles.dropdownOptionActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      form.unit === item ? styles.dropdownOptionTextActive : null,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              )}
            />
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={masterlistPickerField !== null} animationType="slide" transparent>
        <View style={styles.dropdownBackdrop}>
          <SafeAreaView style={styles.dropdownSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>
                {masterlistPickerField === 'brand'
                  ? 'Select Brand'
                  : masterlistPickerField === 'category'
                    ? 'Select Category'
                    : 'Select Sub-category'}
              </Text>
              <Pressable onPress={() => setMasterlistPickerField(null)}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
            {masterlistPickerField ? (
              loadingLookup === masterlistPickerField ? (
                <View style={styles.dropdownLoading}>
                  <ActivityIndicator color="#0b5d4b" />
                </View>
              ) : (
                <FlatList
                  data={suggestions[masterlistPickerField]}
                  keyExtractor={(item) => item}
                  contentContainerStyle={styles.dropdownList}
                  ListEmptyComponent={
                    <Text style={styles.lookupHint}>No saved options found.</Text>
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => applyMasterlistFilter(masterlistPickerField, item)}
                      style={styles.dropdownOption}
                    >
                      <Text style={styles.dropdownOptionText}>{item}</Text>
                    </Pressable>
                  )}
                />
              )
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LookupSuggestionList({
  visible,
  loading,
  options,
  value,
  emptyText,
  onSelect,
}: {
  visible: boolean;
  loading: boolean;
  options: string[];
  value: string;
  emptyText: string;
  onSelect: (value: string) => void;
}) {
  if (!visible) {
    return null;
  }

  if (loading) {
    return (
      <View style={styles.lookupPanel}>
        <Text style={styles.lookupHint}>Loading matches...</Text>
      </View>
    );
  }

  if (!options.length) {
    return (
      <View style={styles.lookupPanel}>
        <Text style={styles.lookupHint}>
          {value.trim() ? emptyText : 'Start typing to search saved values.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.lookupPanel}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onSelect(option)}
          style={styles.lookupOption}
        >
          <Text style={styles.lookupOptionText}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function NavTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.navItem, active ? styles.navItemActive : null]}>
      <Text style={styles.navIconText}>{icon}</Text>
      <Text style={[styles.navText, active ? styles.navTextActive : null]}>{label}</Text>
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
      style={[styles.button, disabled ? styles.buttonDisabled : null]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4efe5',
  },
  page: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingTop: 4,
    paddingBottom: 112,
    gap: 16,
  },
  eyebrow: {
    color: '#8a4b16',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1d2a24',
  },
  subtitle: {
    color: '#495750',
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#fffdf8',
    padding: 16,
    borderRadius: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: '#eadfcd',
  },
  heroCard: {
    backgroundColor: '#1d6b57',
    padding: 18,
    borderRadius: 24,
    gap: 10,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f7fbfa',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1d2a24',
  },
  heroMetric: {
    fontSize: 42,
    fontWeight: '800',
    color: '#fffdf8',
  },
  heroLabel: {
    color: '#dcefe8',
    fontSize: 14,
  },
  quickActions: {
    gap: 10,
    marginTop: 8,
  },
  input: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d8cfbf',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    color: '#1d2a24',
  },
  helperText: {
    color: '#6b6c67',
    fontSize: 12,
    lineHeight: 18,
  },
  importPanel: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dce7df',
    backgroundColor: '#f4faf7',
    padding: 14,
    gap: 8,
  },
  importTitle: {
    color: '#124c3d',
    fontSize: 15,
    fontWeight: '700',
  },
  importText: {
    color: '#496258',
    fontSize: 12,
    lineHeight: 18,
  },
  importStatusCard: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dce7df',
    padding: 12,
    gap: 8,
  },
  importStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  importStatusLabel: {
    color: '#124c3d',
    fontSize: 13,
    fontWeight: '700',
  },
  importStatusValue: {
    color: '#496258',
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#d7e8df',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#1d6b57',
  },
  importStatusText: {
    color: '#345348',
    fontSize: 12,
    lineHeight: 18,
  },
  importStatusMeta: {
    color: '#5f746b',
    fontSize: 11,
    lineHeight: 16,
  },
  lookupBlock: {
    gap: 6,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d8cfbf',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  filterChipText: {
    color: '#1d2a24',
    fontWeight: '600',
  },
  filterChipPlaceholder: {
    color: '#8a8f89',
    fontWeight: '600',
  },
  clearFiltersButton: {
    alignSelf: 'flex-start',
  },
  clearFiltersText: {
    color: '#1d6b57',
    fontWeight: '700',
    fontSize: 12,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  unitInput: {
    width: 96,
  },
  dropdownTrigger: {
    justifyContent: 'center',
  },
  dropdownValue: {
    color: '#1d2a24',
  },
  dropdownPlaceholder: {
    color: '#8a8f89',
  },
  lookupPanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e6dac7',
    backgroundColor: '#fffaf2',
    overflow: 'hidden',
  },
  lookupHint: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#6b6c67',
    fontSize: 12,
    lineHeight: 18,
  },
  lookupOption: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0e7d8',
  },
  lookupOptionText: {
    color: '#1d2a24',
    fontWeight: '600',
  },
  button: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#1d6b57',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#f7fbfa',
    fontWeight: '700',
  },
  loadMoreButton: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d8cfbf',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  loadMoreButtonText: {
    color: '#1d6b57',
    fontWeight: '700',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#efe6d8',
    paddingTop: 12,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1d2a24',
  },
  productMeta: {
    marginTop: 4,
    color: '#68756f',
    fontSize: 12,
    lineHeight: 18,
  },
  emptyText: {
    color: '#68756f',
  },
  deleteButton: {
    borderRadius: 12,
    backgroundColor: '#7f1d1d',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deleteButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  profileTitle: {
    color: '#1d2a24',
    fontSize: 16,
    fontWeight: '700',
  },
  profileText: {
    color: '#495750',
    fontSize: 14,
    lineHeight: 20,
  },
  banner: {
    borderRadius: 18,
    backgroundColor: '#1d2a24',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bannerText: {
    color: '#f7fbfa',
    fontWeight: '600',
  },
  navbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: -16,
    flexDirection: 'row',
    backgroundColor: '#fffdf8',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#eadfcd',
    padding: 8,
    gap: 8,
  },
  navItem: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    gap: 4,
  },
  navIconText: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '700',
    color: '#6b6c67',
  },
  navText: {
    color: '#6b6c67',
    fontWeight: '700',
    fontSize: 12,
  },
  navTextActive: {
    color: '#1d6b57',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  dropdownSheet: {
    maxHeight: '70%',
    backgroundColor: '#fffdf8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  dropdownList: {
    padding: 16,
    gap: 10,
  },
  dropdownLoading: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownOption: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e6dac7',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
  },
  dropdownOptionActive: {
    borderColor: '#1d6b57',
    backgroundColor: '#eef8f4',
  },
  dropdownOptionText: {
    color: '#1d2a24',
    fontWeight: '600',
  },
  dropdownOptionTextActive: {
    color: '#1d6b57',
  },
  modalHeader: {
    backgroundColor: '#fffdf8',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeText: {
    color: '#1d6b57',
    fontWeight: '700',
  },
  camera: {
    flex: 1,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight || 0) + 8 : 8,
    paddingBottom: 12,
    backgroundColor: '#f4efe5',
  },
  appHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1d2a24',
  },
  appHeaderSub: {
    fontSize: 12,
    color: '#68756f',
    marginTop: 1,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8e0d0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonText: {
    fontSize: 22,
    color: '#1d6b57',
    fontWeight: '700',
    lineHeight: 26,
  },
  heroEyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700',
    color: '#a8d5c2',
    textTransform: 'uppercase',
  },
  heroStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  heroStatCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  heroStatLabel: {
    color: '#a8d5c2',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroStatValue: {
    color: '#f7fbfa',
    fontSize: 22,
    fontWeight: '800',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#68756f',
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
    backgroundColor: '#fffdf8',
    borderRadius: 20,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: '#eadfcd',
    minHeight: 110,
  },
  actionCardGreen: {
    backgroundColor: '#1d6b57',
    borderColor: '#1d6b57',
  },
  actionCardIcon: {
    fontSize: 28,
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1d2a24',
    marginTop: 4,
  },
  actionCardTitleLight: {
    color: '#f7fbfa',
  },
  actionCardDesc: {
    fontSize: 12,
    color: '#68756f',
  },
  actionCardDescLight: {
    color: '#a8d5c2',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1d6b57',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#efe6d8',
    paddingTop: 12,
  },
  activityIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#eef8f4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityIconText: {
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
    backgroundColor: '#eef8f4',
    borderRadius: 16,
  },
});
