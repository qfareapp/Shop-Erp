# Shop ERP Phase 1

Phase 1 delivers the daily-usage workflow for a small shop:

- barcode-based product entry
- manual fallback when barcode lookup fails
- photo-based OCR fallback when barcode is missing from catalog
- inventory per shop
- barcode billing and sale recording

## Structure

- `mobile` - Expo React Native app
- `api` - Express + MongoDB backend

## Backend setup

1. Create `api/.env` from `api/.env.example`.
2. Ensure MongoDB is running locally or update `MONGODB_URI`.
3. Enable the Cloud Vision API in your Google Cloud project.
4. Create a service account with Vision access and download its JSON key.
5. Set `GOOGLE_APPLICATION_CREDENTIALS` in `api/.env` to that JSON key path.
6. Start the API:

```bash
cd api
npm run dev
```

If Google Vision credentials are missing or invalid, `POST /api/products/ocr-suggest` returns a setup error.

## Mobile setup

1. Start the Expo app:

```bash
cd mobile
npm start
```

2. Both Expo apps are hardcoded to use:

- `http://192.168.16.20:4000`

## Phase 1 capabilities

- add a product by scanning or typing barcode
- use manual entry for unknown barcode
- if barcode lookup fails, take or choose a product photo
- run OCR through Google Cloud Vision
- suggest product details from OCR text and existing catalog matches
- maintain opening stock
- scan product into billing cart
- complete sale and reduce stock
- view current inventory and recent sales
