# Harvest Sun

Game kehidupan desa 2D berbahasa Indonesia. Satu Lembah Surya menampung sampai delapan pemain. Setiap pemain bisa memilih profesi Petani, Peternak, atau Pedagang dan berkontribusi pada ekonomi desa yang sama.

## Main lokal

Jalankan dengan Node.js 22 atau lebih baru.

```powershell
npm run dev
```

Buka `http://127.0.0.1:4173`. Dari menu utama, pilih **Buat lembah** atau **Gabung teman**. Pilih profesi, kemudian buka tautan undangan di jendela privat atau browser lain untuk mencoba dua karakter. Dunia, inventaris, dan chat tersimpan di `.local/`. Jalankan `npm test` untuk memeriksa aturan permainan.

Progres otomatis tersimpan tiap aksi. Gunakan **Menu → Simpan sekarang** atau **Simpan & kembali**, lalu pilih **Muat permainan** dari layar judul untuk memilih karakter tersimpan di browser itu. Saat memuat, kamu melanjutkan keadaan lembah bersama yang terbaru.

- Geser analog layar, gunakan **WASD** atau tombol panah, atau ketuk peta untuk berjalan. Tekan **E** atau ketuk tombol aksi untuk berinteraksi. Kamera mengikuti karakter dan menyesuaikan layar portrait atau landscape.
- Pilih benih wortel, tomat, atau jagung di **Tanaman**. Karakter mencangkul saat menanam. Isi ember di sumur dan siram petak untuk memulai waktu tumbuh.
- Rawat ayam, sapi, atau kambing di pagar masing-masing. Beri pakan dan minum sebelum memanen telur atau memerah susu. Dua induk dan dua pakan diperlukan untuk pembiakan. Ternak bisa mati setelah 8 menit tanpa pakan atau 6 menit tanpa minum selama permainan aktif. Waktu offline dan saat kembali ke judul dijeda.
- Beli pakan seharga 4 koin di **Toko Pakan** dekat lumbung. Toko yang sama bisa meracik 1 jagung + 1 rumput liar menjadi 3 pakan, atau 3 rumput liar menjadi 1 pakan. Rumput bisa dipetik di tepi jalan, hutan, dan seberang sungai.
- Tebang pohon kayu di hutan, lalu jual kayu, hasil kebun, atau hasil ternak ke **Bu Rini** di Pasar Surya. Tab **Beli kebutuhan** menyediakan benih dan persediaan lain.
- Buka **Tas** untuk melihat gambar dan jumlah barang. Ketuk makanan untuk makan. Setiap karakter mendapat rumah sendiri dengan dapur dan ranjang. Nama lokasi muncul sebentar di tengah layar saat kamu mendekat. Satu hari di lembah berlangsung empat menit.
- Titipkan makanan di lumbung atau gunakan **Teman** saat berdiri dekat pemain lain. Rencanakan tugas lewat **Chat**.
- **Misi** menampilkan tujuan pribadi dan kemajuan semua pemain. Panen, hasil ternak, sumbangan makanan, serta dana bersama membuka Kebun Selatan dan Ladang Tepi Sungai. Lembah berkembang dari Rintisan menjadi Sejahtera.
- Pop-up menunjukkan barang atau hadiah yang diterima. Efek suara dapat dibisukan di **Menu**.
- Peta 54 × 32 memuat Hutan Embun, Bukit Angin, dan Gua Batu Surya. **Jelajah** menampilkan peta kecil dan petunjuk temuan. Beri hutan bisa dimakan, kuarsa bisa dijual, dan tiga temuan membuka jembatan selatan, 12 petak Teras Purnama, serta budidaya buah bulan.
- Tautan undangan membuka lembah di browser lain. Karakter dikenali oleh sesi yang tersimpan di browser tempat karakter dibuat.

## Deploy ke Vercel

Untuk deploy manual dari folder proyek, jalankan `npx vercel link`, lalu hubungkan Upstash pada proyek yang dipilih. Jalankan `npx vercel deploy` untuk Preview dan `npx vercel deploy --prod` setelah pengujian berhasil. Aktifkan variabel Upstash pada environment yang akan dipakai. `.vercelignore` membatasi unggahan CLI ke API, aset web, dan konfigurasi deployment. Save lokal di `.local/` tetap berada di komputer.

1. Impor repo ini sebagai proyek Vercel dengan preset **Other**. Gunakan root repo sebagai **Root Directory**. `vercel.json` sudah menunjuk aset statis ke `public/` dan API berada di `api/game.js`.
2. Hubungkan Redis dari Vercel Marketplace melalui integrasi Upstash. Pastikan `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` tersedia pada environment deployment. Nama alias `KV_REST_API_URL` dan `KV_REST_API_TOKEN` juga didukung. Gunakan REST token dengan izin tulis.
3. Deploy atau redeploy. Buka URL deployment, buat lembah, lalu buka tautan undangan dari browser lain. Kedua karakter, petak, dan lumbung akan memakai penyimpanan Redis yang sama.

Posisi dan aksi disinkronkan lewat HTTP. Server memvalidasi aksi dan memakai pembaruan atomik Redis agar dua pemain tidak dapat mengambil persediaan yang sama. Jalur penyimpanan lokal dipakai saat menjalankan game sendiri tanpa Redis. Vercel memerlukan Redis agar satu lembah tetap tersimpan lintas invokasi. [Dokumentasi Vercel](https://vercel.com/docs/redis) · [REST API Upstash](https://upstash.com/docs/redis/features/restapi)

## Aset

Grafis orisinal di `public/assets/` dibuat dengan sprite-gen menggunakan GPT. Sheet bangunan, ternak, tanaman, dan ikon diproses melalui `sprite-gen slice-sheet`. Permintaan atlas karakter tersimpan di [art/villager-request.json](art/villager-request.json). Runtime membaca koordinat frame dan timing langsung dari manifest atlas. Tata letak peta, cahaya malam, dan efek permukaan air dirender oleh kode game.
