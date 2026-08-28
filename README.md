# AllDrive Storage

AllDrive Storage adalah object storage berbasis Google Drive. Aplikasi ini menyediakan dashboard untuk mengelola bucket, folder nested, object, API key, dan akun Google Drive, sekaligus gateway yang kompatibel dengan Amazon S3.

## Fitur Utama

- Menyimpan file ke Google Drive melalui bucket yang terisolasi.
- Membuat folder nested otomatis dari object key, misalnya `images/2026/avatar.png`.
- API key dengan permission granular seperti `file:read`, `file:create`, dan `file:delete`.
- S3 Signature Version 4 untuk AWS SDK, AWS CLI, dan tools S3-compatible.
- Streaming download dengan dukungan HTTP Range untuk preview video.
- Dashboard liquid glass untuk storage, API keys, bucket, domain, dan dokumentasi.

## Teknologi

- Next.js 16 dan TypeScript
- Prisma 6 dan MySQL
- Google Drive API
- AWS SDK for JavaScript v3

## Menjalankan Lokal

Prasyarat: Node.js 20+, MySQL, dan project Google Cloud dengan Google Drive API aktif.

```bash
npm install
copy .env.example .env
npx prisma db push
npm run dev
```

Buka `http://localhost:3000`. Isi `.env` dengan koneksi MySQL, secret NextAuth, encryption key 32-byte, serta OAuth credentials Google. Tambahkan redirect URI berikut di Google Cloud:

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/google-drive/callback
```

## S3-Compatible API

Gateway S3 tersedia di:

```text
http://localhost:3000/s3
```

Buat API key dari halaman **API Keys**. Saat key dibuat, simpan `s3_access_key_id` dan `s3_secret_access_key`; secret hanya ditampilkan sekali. Bucket API key menentukan bucket S3 yang dapat diakses.

### AWS SDK JavaScript

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "http://localhost:3000/s3",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

await s3.send(new PutObjectCommand({
  Bucket: "test-bucket",
  Key: "images/2026/avatar.png",
  Body: imageBuffer,
  ContentType: "image/png",
}));

const result = await s3.send(new GetObjectCommand({
  Bucket: "test-bucket",
  Key: "images/2026/avatar.png",
}));
```

Nested key otomatis membuat folder yang belum ada di database dan Google Drive. File tanpa folder dapat di-upload langsung dengan key seperti `root-file.txt`.

### AWS CLI

```bash
aws s3 cp ./file.txt s3://test-bucket/docs/file.txt \
  --endpoint-url http://localhost:3000/s3 \
  --region us-east-1
```

Operasi yang didukung: `PutObject`, `GetObject`, `HeadObject`, `ListObjectsV2`, `DeleteObject`, dan `DeleteObjects`. Permission API key diterapkan pada gateway: upload memakai `file:create`, baca/list memakai `file:read`, dan hapus memakai `file:delete`.

## Endpoint API Native

API native tetap tersedia di `/api/v1` untuk operasi bucket, folder, object, video, API key, dan custom domain. Dokumentasi interaktif dapat dibuka dari `/dashboard/docs` setelah login.

## Keamanan

- Jangan commit `.env` atau credential Google/API key.
- Simpan `s3_secret_access_key` di secret manager atau environment variable.
- Gunakan HTTPS dan domain production saat aplikasi dipublikasikan.
- Revoke API key yang tidak lagi digunakan.
