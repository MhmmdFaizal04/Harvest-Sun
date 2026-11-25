# Pemeriksaan aset Harvest Sun

Grafis lingkungan, ikon, ayam dan interior dibuat dengan sprite-gen menggunakan GPT. Karakter memakai atlas RGBA 224 × 336 dengan enam baris dan empat frame per baris. Palet Peternak dan Pedagang diproses dengan sprite-gen Recolor. Sisi kiri memakai pantulan dari profil kanan.

| Baris | Pemeriksaan |
| --- | --- |
| Down idle | Gerak ringan dan siluet konsisten. Ekstraktor memakai pitch bersama pada beberapa frame. |
| Side idle | Profil konsisten. Beberapa frame melewati area aman internal dan tetap muat di sel. |
| Up idle | Bentuk topi dan tampak belakang konsisten. Ekstraktor memakai pitch bersama pada beberapa frame. |
| Down walk | Langkah terbaca. Siklus pendek bergaya pixel art, dengan perubahan kaki tipis di tampak depan. |
| Side walk | Pergantian kaki terlihat di profil. Siklus empat frame, dengan perbedaan estimasi pitch antarsumbu. |
| Up walk | Arah belakang terbaca. Siklus empat frame dengan perubahan kaki kecil. |

Ekstraksi, komposisi, dan inspeksi otomatis berhasil. Runtime memakai koordinat dan laju frame pada manifest. Gerak berjalan adalah siklus pendek untuk prototipe.

Atlas kerja memakai empat frame per aksi tanpa pengulangan. Cangkul dan kapak terlihat pada tiap pose, kantong pakan berubah sudut saat dituang, dan gembor miring saat menyiram. Sprite-gen melaporkan ekstraksi dan komposisi tanpa peringatan.
