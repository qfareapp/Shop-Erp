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

## Deployment

### Render API

The repo includes a root [`render.yaml`](./render.yaml) for the `api` service.

Set these Render environment variables:

- `MONGODB_URI`
- `GOOGLE_CLOUD_VISION_CREDENTIALS`

`GOOGLE_CLOUD_VISION_CREDENTIALS` should contain the full Google service-account JSON as a single env var value.

### Vercel frontend

Both Expo apps can be deployed to Vercel as static web exports:

- `admin/vercel.json`
- `mobile/vercel.json`

For each Vercel project:

1. Set the project root to `admin` or `mobile`.
2. Set `EXPO_PUBLIC_API_URL` to your deployed Render API URL, for example:

```bash
https://your-render-service.onrender.com
```

3. Deploy with the included `npm run build:web` command.

## Mobile setup

1. Start the Expo app:

```bash
cd mobile
npm start
```

2. Set `EXPO_PUBLIC_API_URL` if you are not using the local default:

- `http://127.0.0.1:4000`

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
