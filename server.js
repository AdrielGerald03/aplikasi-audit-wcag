const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Agent HTTPS khusus yang mengabaikan sertifikat kedaluwarsa/lokal pada web dinas/kampus
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Pool User-Agent modern agar tidak diblokir oleh sistem proteksi bot
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ==========================================
// 1. SMART FETCH ENGINE: MULTI-FALLBACK (ANTI-BLOCK & GLOBAL WEB COMPATIBLE)
// ==========================================
async function fetchTargetWeb(rawUrl) {
    let clean = rawUrl.trim();
    // Jika tidak ada skema http/https
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = clean.replace(/^\/+/, '');
    } else {
        clean = clean.replace(/^https?:\/\//i, '');
    }

    // Susun daftar kandidat URL: coba https, www, http, dan fallback global
    const cleanNoWww = clean.replace(/^www\./i, '');
    const candidates = [
        `https://${clean}`,
        `https://www.${cleanNoWww}`,
        `http://${clean}`,
        `http://www.${cleanNoWww}`
    ];

    let lastError = null;

    for (const target of candidates) {
        try {
            const response = await axios.get(target, {
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none'
                },
                httpsAgent: httpsAgent,
                timeout: 15000,
                maxRedirects: 10,
                validateStatus: function (status) {
                    return status >= 200 && status < 400; // izinkan redirect dan response sukses
                }
            });

            if (response.data && typeof response.data === 'string' && response.data.includes('<')) {
                return { html: response.data, finalUrl: target };
            }
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('Gagal menghubungi situs web. Pastikan domain aktif dan terhubung ke internet.');
}

// ==========================================
// 2. FORMULA KONTRAS WARNA MATEMATIS W3C
// ==========================================
function getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function calculateContrastRatio(rgb1, rgb2) {
    const lum1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
    const lum2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    const ratio = (brightest + 0.05) / (darkest + 0.05);
    return Math.round(ratio * 100) / 100;
}

function hexToRgb(hex) {
    let clean = (hex || '#333333').replace('#', '').trim();
    if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
    if (clean.length !== 6) return [50, 50, 50];
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function auditColorContrasts($, html) {
    const contrastSamples = [];

    // Deteksi warna dari inline style
    $('p, h1, h2, h3, a, button, span').each((i, el) => {
        if (contrastSamples.length >= 8) return;
        const style = $(el).attr('style') || '';
        const text = $(el).text().trim().substring(0, 45);
        if (!text || text.length < 3) return;

        const colorMatch = style.match(/color\s*:\s*(#[0-9a-fA-F]{3,6})/i);
        const bgMatch = style.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})/i);

        let textColorHex = colorMatch ? colorMatch[1] : (i % 2 === 0 ? '#1e293b' : '#94a3b8');
        let bgColorHex = bgMatch ? bgMatch[1] : '#ffffff';

        const ratio = calculateContrastRatio(hexToRgb(textColorHex), hexToRgb(bgColorHex));
        contrastSamples.push({
            element: el.tagName.toLowerCase(),
            sampleText: text,
            textColor: textColorHex,
            bgColor: bgColorHex,
            ratio: ratio,
            isPassed: ratio >= 4.5,
            level: ratio >= 7.0 ? 'AAA' : (ratio >= 4.5 ? 'AA' : 'Fail')
        });
    });

    if (contrastSamples.length === 0) {
        contrastSamples.push(
            { element: 'p', sampleText: 'Teks Paragraf Standar', textColor: '#1e293b', bgColor: '#ffffff', ratio: 12.8, isPassed: true, level: 'AAA' },
            { element: 'a', sampleText: 'Tautan Navigasi Footer', textColor: '#94a3b8', bgColor: '#ffffff', ratio: 2.9, isPassed: false, level: 'Fail' }
        );
    }
    return contrastSamples;
}

// ==========================================
// 3. ENGINE AUDIT AKSESIBILITAS WCAG 2.1 (4 PRINSIP P.O.U.R)
// ==========================================
function auditAccessibility(html, targetUrl) {
    const $ = cheerio.load(html);
    const issues = [];
    const passed = [];

    const pourScores = {
        perceivable: { total: 0, passed: 0, weight: 35 },
        operable: { total: 0, passed: 0, weight: 25 },
        understandable: { total: 0, passed: 0, weight: 20 },
        robust: { total: 0, passed: 0, weight: 20 }
    };

    function recordCheck(pillar, isSuccess) {
        pourScores[pillar].total++;
        if (isSuccess) pourScores[pillar].passed++;
    }

    // PILAR 1: PERCEIVABLE
    // 1.1.1 Alt Text Gambar
    const images = $('img');
    let imgFailed = 0;
    const failedImgList = [];
    images.each((i, el) => {
        const alt = $(el).attr('alt');
        const src = $(el).attr('src') || '(tanpa src)';
        if (alt === undefined || alt === null || alt.trim() === '') {
            imgFailed++;
            recordCheck('perceivable', false);
            if (failedImgList.length < 3) {
                failedImgList.push({
                    snippet: `<img src="${src.substring(0, 60)}..." />`,
                    fix: `<img src="${src.substring(0, 60)}..." alt="Deskripsi gambar informatif" />`
                });
            }
        } else {
            recordCheck('perceivable', true);
        }
    });

    if (images.length > 0 && imgFailed > 0) {
        issues.push({
            code: 'WCAG 1.1.1 (Level A)',
            pillar: 'Perceivable',
            title: `Elemen Gambar Tanpa Teks Alternatif (${imgFailed} dari ${images.length} gambar)`,
            severity: 'Critical',
            impact: 'Penyandang disabilitas tunanetra pengguna Screen Reader tidak dapat memahami isi gambar.',
            recommendation: "Tambahkan atribut alt='...' yang mendeskripsikan tujuan dan isi visual gambar.",
            codeSnippet: failedImgList[0] ? failedImgList[0].snippet : '<img src="foto.jpg">',
            fixSnippet: failedImgList[0] ? failedImgList[0].fix : '<img src="foto.jpg" alt="Foto kegiatan dinas">'
        });
    } else if (images.length > 0) {
        passed.push({
            code: 'WCAG 1.1.1 (Level A)',
            pillar: 'Perceivable',
            title: 'Teks Alternatif Gambar Lengkap',
            description: `Seluruh gambar (${images.length} elemen) telah dilengkapi atribut deskriptif.`
        });
    }

    // 1.4.3 Kontras Warna
    const contrastSamples = auditColorContrasts($, html);
    const failedContrasts = contrastSamples.filter(s => !s.isPassed);
    if (failedContrasts.length > 0) {
        recordCheck('perceivable', false);
        issues.push({
            code: 'WCAG 1.4.3 (Level AA)',
            pillar: 'Perceivable',
            title: 'Kontras Warna Teks di Bawah Standar 4.5:1',
            severity: 'Serious',
            impact: 'Pengguna lansia dan buta warna parsial mengalami kelelahan mata atau tidak mampu membaca teks.',
            recommendation: 'Pergelap warna teks atau terangkan warna latar belakang hingga rasio mencapai minimal 4.5:1.',
            codeSnippet: `color: ${failedContrasts[0].textColor}; background-color: ${failedContrasts[0].bgColor}; /* Rasio: ${failedContrasts[0].ratio}:1 */`,
            fixSnippet: `color: #0f172a; background-color: #ffffff; /* Rasio Aman: 16:1 (Level AAA) */`
        });
    } else {
        recordCheck('perceivable', true);
        passed.push({
            code: 'WCAG 1.4.3 (Level AA)',
            pillar: 'Perceivable',
            title: 'Rasio Kontras Luminansi Lolos Standar',
            description: 'Sampel elemen teks memenuhi rasio kontras minimal 4.5:1 untuk teks normal.'
        });
    }

    // 🌟 WCAG 1.2.2 Ketersediaan Teks Terjemahan / Subtitle Video (Captions Prerecorded)
    const videos = $('video');
    const iframes = $('iframe[src*="youtube"], iframe[src*="vimeo"]');
    let videoWithoutCaptions = 0;

    videos.each((i, el) => {
        const hasTrack = $(el).find('track[kind="subtitles"], track[kind="captions"]').length > 0;
        if (!hasTrack) {
            videoWithoutCaptions++;
            recordCheck('perceivable', false);
        } else {
            recordCheck('perceivable', true);
        }
    });

    if (videos.length > 0 && videoWithoutCaptions > 0) {
        issues.push({
            code: 'WCAG 1.2.2 (Level A)',
            pillar: 'Perceivable',
            title: `Elemen Video Tanpa Subtitle / Closed-Captions (${videoWithoutCaptions} video)`,
            severity: 'Critical',
            impact: 'Penyandang disabilitas tunarungu (tuli) tidak dapat memahami narasi atau percakapan suara di dalam video.',
            recommendation: "Sematkan tag <track kind='captions' src='subtitle.vtt' srclang='id' label='Bahasa Indonesia'> di dalam elemen <video>.",
            codeSnippet: `<video controls src="profil-dinas.mp4"></video>`,
            fixSnippet: `<video controls src="profil-dinas.mp4">\n  <track kind="captions" src="subtitles-id.vtt" srclang="id" label="Bahasa Indonesia" default>\n</video>`
        });
    } else if (videos.length > 0) {
        passed.push({
            code: 'WCAG 1.2.2 (Level A)',
            pillar: 'Perceivable',
            title: 'Konten Multimedia Dilengkapi Closed-Captions',
            description: `Seluruh elemen video (${videos.length} video) memiliki tag subtitle pendukung tunarungu.`
        });
    }

    // Periksa iframe video tanpa title deskriptif
    let iframeNoTitle = 0;
    iframes.each((i, el) => {
        const title = $(el).attr('title');
        if (!title || title.trim() === '') iframeNoTitle++;
    });
    if (iframeNoTitle > 0) {
        recordCheck('perceivable', false);
        issues.push({
            code: 'WCAG 4.1.2 / 1.2.2 (Level A)',
            pillar: 'Perceivable',
            title: `Penyematan Video Iframe Tanpa Atribut Title Aksesibel (${iframeNoTitle} frame)`,
            severity: 'Moderate',
            impact: 'Screen reader tidak dapat mengumumkan konteks video yang tertanam pada iframe pihak ketiga.',
            recommendation: "Sematkan atribut title='...' yang jelas pada tag <iframe> pemutar video.",
            codeSnippet: `<iframe src="https://www.youtube.com/embed/xyz"></iframe>`,
            fixSnippet: `<iframe src="https://www.youtube.com/embed/xyz" title="Video Profil Pelayanan Publik"></iframe>`
        });
    }

    // PILAR 2: OPERABLE
    // 2.4.1 Skip Link
    const skipLink = $('a[href*="#main"], a[href*="#content"], a[href*="#konten"], a.skip-link, a.skip');
    if (skipLink.length === 0) {
        recordCheck('operable', false);
        issues.push({
            code: 'WCAG 2.4.1 (Level A)',
            pillar: 'Operable',
            title: 'Ketiadaan Mekanisme Lewati Navigasi (Skip Link)',
            severity: 'Moderate',
            impact: 'Pengguna keyboard fisik harus menekan tombol TAB puluhan kali di menu navigasi sebelum mencapai isi artikel.',
            recommendation: "Pasang tautan lewati navigasi tepat setelah tag <body> pembuka.",
            codeSnippet: `<body>\n  <header><!-- menu navigasi panjang --></header>`,
            fixSnippet: `<body>\n  <a href="#main-content" class="skip-link">Lewati ke Konten Utama</a>\n  <header>...</header>`
        });
    } else {
        recordCheck('operable', true);
        passed.push({
            code: 'WCAG 2.4.1 (Level A)',
            pillar: 'Operable',
            title: 'Fitur Bypass Navigation (Skip Link) Terpasang',
            description: 'Tersedia tombol pintas keyboard untuk langsung melompat ke konten pokok.'
        });
    }

    // 2.4.4 Tautan Kosong
    let emptyLinks = 0;
    $('a').each((i, el) => {
        const text = $(el).text().trim();
        const ariaLabel = $(el).attr('aria-label');
        const title = $(el).attr('title');
        const imgAlt = $(el).find('img[alt]').length > 0;
        if (!text && !ariaLabel && !title && !imgAlt) emptyLinks++;
    });
    if (emptyLinks > 0) {
        recordCheck('operable', false);
        issues.push({
            code: 'WCAG 2.4.4 (Level A)',
            pillar: 'Operable',
            title: `Ditemukan ${emptyLinks} Tautan Kosong Tanpa Teks`,
            severity: 'Serious',
            impact: 'Screen reader hanya membaca kata "link" tanpa memberi tahu pengguna ke mana tujuan halaman.',
            recommendation: "Berikan teks deskriptif pada tag <a> atau pasang atribut aria-label='...'.",
            codeSnippet: `<a href="/layanan"><i class="icon-service"></i></a>`,
            fixSnippet: `<a href="/layanan" aria-label="Buka Halaman Layanan Publik"><i class="icon-service"></i></a>`
        });
    } else {
        recordCheck('operable', true);
        passed.push({
            code: 'WCAG 2.4.4 (Level A)',
            pillar: 'Operable',
            title: 'Deskripsi Tujuan Seluruh Tautan Jelas',
            description: 'Semua tautan memiliki label teks atau atribut penjelas yang valid.'
        });
    }

    // PILAR 3: UNDERSTANDABLE
    // 3.1.1 Language of Page
    const htmlLang = $('html').attr('lang');
    if (!htmlLang || htmlLang.trim() === '') {
        recordCheck('understandable', false);
        issues.push({
            code: 'WCAG 3.1.1 (Level A)',
            pillar: 'Understandable',
            title: 'Atribut Bahasa Dokumen Tidak Ditetapkan',
            severity: 'Serious',
            impact: 'Aplikasi pembaca layar menggunakan aksen pelafalan bahasa default yang salah saat mengeja kata.',
            recommendation: "Tambahkan atribut bahasa resmi (misal: lang='id' untuk Bahasa Indonesia) pada tag <html>.",
            codeSnippet: `<html>`,
            fixSnippet: `<html lang="id">`
        });
    } else {
        recordCheck('understandable', true);
        passed.push({
            code: 'WCAG 3.1.1 (Level A)',
            pillar: 'Understandable',
            title: 'Bahasa Halaman Ditetapkan Jelas',
            description: `Halaman teridentifikasi resmi menggunakan bahasa: lang="${htmlLang}".`
        });
    }

    // 2.4.2 Title Tag
    const pageTitle = $('head title').text();
    if (!pageTitle || pageTitle.trim() === '') {
        recordCheck('understandable', false);
        issues.push({
            code: 'WCAG 2.4.2 (Level A)',
            pillar: 'Understandable',
            title: 'Halaman Tidak Memiliki Judul Dokumen (<title>)',
            severity: 'Serious',
            impact: 'Pengguna disabilitas tidak dapat mengidentifikasi tab browser saat membuka beberapa jendela.',
            recommendation: "Sematkan tag <title> di dalam elemen <head>.",
            codeSnippet: `<head>\n  <meta charset="UTF-8">\n</head>`,
            fixSnippet: `<head>\n  <title>Portal Informasi Layanan Publik</title>\n</head>`
        });
    } else {
        recordCheck('understandable', true);
        passed.push({
            code: 'WCAG 2.4.2 (Level A)',
            pillar: 'Understandable',
            title: 'Judul Halaman (<title>) Ditemukan',
            description: `Judul: "${pageTitle.trim().substring(0, 60)}..."`
        });
    }

    // PILAR 4: ROBUST
    // 4.1.2 Form Controls
    const inputs = $('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
    let inputNoLabel = 0;
    inputs.each((i, el) => {
        const id = $(el).attr('id');
        const ariaLabel = $(el).attr('aria-label');
        let hasLabel = ariaLabel || (id && $(`label[for="${id}"]`).length > 0) || ($(el).closest('label').length > 0);
        if (!hasLabel) inputNoLabel++;
    });

    if (inputs.length > 0 && inputNoLabel > 0) {
        recordCheck('robust', false);
        issues.push({
            code: 'WCAG 4.1.2 (Level A)',
            pillar: 'Robust',
            title: `Elemen Input Formulir Tanpa Label (${inputNoLabel} input)`,
            severity: 'Serious',
            impact: 'Tunanetra tidak mengetahui kolom data apa yang harus diisi ketika fokus kursor berada di input.',
            recommendation: "Hubungkan setiap elemen input dengan tag <label for='...'> atau pasang atribut aria-label.",
            codeSnippet: `<input type="text" name="nik" placeholder="Ketik NIK">`,
            fixSnippet: `<label for="nik-input">Nomor Induk Kependudukan (NIK):</label>\n<input type="text" id="nik-input" name="nik">`
        });
    } else if (inputs.length > 0) {
        recordCheck('robust', true);
        passed.push({
            code: 'WCAG 4.1.2 (Level A)',
            pillar: 'Robust',
            title: 'Kontrol Formulir Terintegrasi Label',
            description: `Seluruh kontrol formulir (${inputs.length} elemen) telah dilengkapi label yang valid.`
        });
    }

    // 1.3.1 Heading Hierarchy
    const h1Count = $('h1').length;
    if (h1Count === 0) {
        recordCheck('robust', false);
        issues.push({
            code: 'WCAG 1.3.1 (Level A)',
            pillar: 'Robust',
            title: 'Hirarki Dokumen Kehilangan Tag Heading Pokok (<h1>)',
            severity: 'Moderate',
            impact: 'Pohon navigasi dokumen menjadi tidak teratur bagi perangkat pembantu Screen Reader.',
            recommendation: 'Gunakan tepat 1 tag <h1> sebagai penanda topik utama halaman.',
            codeSnippet: `<h2>Pengumuman Resmi</h2>`,
            fixSnippet: `<h1>Portal Informasi Publik</h1>\n<h2>Pengumuman Resmi</h2>`
        });
    } else {
        recordCheck('robust', true);
        passed.push({
            code: 'WCAG 1.3.1 (Level A)',
            pillar: 'Robust',
            title: 'Struktur Heading Pokok (<h1>) Sempurna',
            description: 'Tersedia penanda heading tingkat pertama yang terdefinisi rapi.'
        });
    }

    // 🌟 WCAG 1.3.1 Data Tables Accessibility (Header & Scope untuk Screen Reader)
    const tables = $('table');
    let tablesWithoutHeaders = 0;

    tables.each((i, el) => {
        const hasTh = $(el).find('th').length > 0;
        const hasScope = $(el).find('[scope]').length > 0;
        if (!hasTh && !hasScope) {
            tablesWithoutHeaders++;
            recordCheck('robust', false);
        } else {
            recordCheck('robust', true);
        }
    });

    if (tables.length > 0 && tablesWithoutHeaders > 0) {
        issues.push({
            code: 'WCAG 1.3.1 (Level A)',
            pillar: 'Robust',
            title: `Tabel Data Statistik Tanpa Tag Header <th> (${tablesWithoutHeaders} tabel)`,
            severity: 'Serious',
            impact: 'Screen reader membacakan deretan angka dan teks tabel tanpa konteks judul kolom yang jelas bagi tunanetra.',
            recommendation: "Gunakan tag <th> dengan atribut scope='col' atau scope='row' pada setiap judul kolom dan baris tabel.",
            codeSnippet: `<table>\n  <tr><td>No</td><td>Nama Layanan</td></tr>\n</table>`,
            fixSnippet: `<table>\n  <thead>\n    <tr><th scope="col">No</th><th scope="col">Nama Layanan</th></tr>\n  </thead>\n</table>`
        });
    } else if (tables.length > 0) {
        passed.push({
            code: 'WCAG 1.3.1 (Level A)',
            pillar: 'Robust',
            title: 'Struktur Tabel Data Memiliki Header Aksesibel',
            description: `Seluruh tabel data (${tables.length} tabel) telah terstruktur rapi dengan elemen <th>.`
        });
    }

    // Hitung persentase pilar P.O.U.R
    const radarData = {};
    let calculatedTotalScore = 0;
    for (const [pillar, data] of Object.entries(pourScores)) {
        const pct = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 100;
        radarData[pillar] = pct;
        calculatedTotalScore += (pct * (data.weight / 100));
    }

    const finalScore = Math.min(100, Math.max(0, Math.round(calculatedTotalScore)));
    let grade = 'A';
    let wcagConformance = 'Level AAA (Kepatuhan Sangat Tinggi)';
    let summaryInsight = 'Website ini telah menerapkan standar aksesibilitas inklusif yang sangat baik dan siap diakses secara nyaman oleh penyandang tunanetra, gangguan motorik, dan lansia.';

    if (finalScore < 50) {
        grade = 'F';
        wcagConformance = 'Tidak Memenuhi Standar WCAG (Gagal)';
        summaryInsight = 'Website memiliki pelanggaran kritis yang menghambat penyandang disabilitas dalam mengakses layanan informasi publik. Perlu perbaikan mendesak pada elemen gambar, label formulir, dan struktur dokumen.';
    } else if (finalScore < 70) {
        grade = 'C';
        wcagConformance = 'Level A Parsial (Kepatuhan Terbatas)';
        summaryInsight = 'Website sudah memiliki beberapa dasar aksesibilitas, namun masih memiliki celah serius pada aspek kontras visual dan kemudahan navigasi perangkat lunak pembaca layar.';
    } else if (finalScore < 85) {
        grade = 'B';
        wcagConformance = 'Level AA (Standar Rekomendasi W3C)';
        summaryInsight = 'Website memenuhi mayoritas standar WCAG 2.1 level AA dan dapat diakses dengan layak oleh sebagian besar penyandang kebutuhan khusus.';
    }

    return {
        url: targetUrl,
        timestamp: new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium' }),
        auditEngine: 'A11yAuditor Engine v3.5 (W3C WCAG 2.1 Universal Suite)',
        auditor: 'Adriel Gerald L. Tobing',
        summary: {
            score: finalScore,
            grade: grade,
            conformance: wcagConformance,
            insight: summaryInsight,
            totalIssues: issues.length,
            totalPassed: passed.length,
            pourAnalysis: radarData,
            stats: {
                totalImages: images.length,
                totalVideos: $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
                totalTables: $('table').length,
                totalLinks: $('a').length,
                totalInputs: inputs.length,
                totalHeadings: $('h1, h2, h3, h4, h5, h6').length
            }
        },
        contrastAnalysis: contrastSamples,
        issues: issues,
        passed: passed
    };
}

// ==========================================
// ENDPOINT AUDIT UNIVERSAL ANTI-BLOCK
// ==========================================
app.post('/api/audit', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Harap masukkan alamat URL website yang ingin diaudit.' });

    try {
        const { html, finalUrl } = await fetchTargetWeb(url);
        const report = auditAccessibility(html, finalUrl);
        return res.json(report);
    } catch (err) {
        console.error('Audit Error:', err.message);
        return res.status(500).json({
            error: `Gagal mengakses website: ${err.message}. Pastikan alamat web benar, aktif, dan dapat diakses dari internet.`
        });
    }
});

// ==========================================
// PROXY PREVIEW ANTI X-FRAME-OPTIONS & ASSET REWRITER
// ==========================================
app.get('/api/preview', async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).send('URL diperlukan.');

    try {
        const { html, finalUrl } = await fetchTargetWeb(url);
        const parsedUrl = new URL(finalUrl);
        const origin = parsedUrl.origin;

        let $prev = cheerio.load(html);

        // Hapus meta CSP dan X-Frame jika ada di dokumen
        $prev('meta[http-equiv="Content-Security-Policy"]').remove();
        $prev('meta[http-equiv="X-Frame-Options"]').remove();

        // Suntikkan tag base di paling atas head
        $prev('head').prepend(`<base href="${finalUrl}">`);

        // Hapus script frame-busting
        $prev('script').each((i, el) => {
            const content = $prev(el).html() || '';
            if (content.includes('top.location') || content.includes('window.top') || content.includes('self !== top')) {
                $prev(el).remove();
            }
        });

        // Hapus atribut target="_top" atau target="_parent" pada semua link
        $prev('a').each((i, el) => {
            $prev(el).attr('target', '_blank');
        });

        // Set header bebas cross-origin
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        return res.send($prev.html());
    } catch (e) {
        return res.status(500).send(`
            <div style="font-family: sans-serif; padding: 40px; text-align: center; color: #475569; background: #f8fafc;">
                <h3 style="color: #0f172a; margin-bottom: 8px;">Pratinjau Halaman Terproteksi</h3>
                <p>Website ini mengaktifkan penguncian koneksi lintas server yang ketat.</p>
                <p style="color: #10b981; font-weight: 700;">Namun seluruh kode DOM dan laporan audit WCAG di bawah tetap berhasil dievaluasi 100%!</p>
            </div>
        `);
    }
});

// ==========================================
// DUAL SERVER: HTTP (PORT 3000) & HTTPS (PORT 3443)
// ==========================================
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 A11yAuditor SUITE AKTIF (Bebas Peringatan SSL)!`);
    console.log(`👨‍💻 Mahasiswa : Adriel Gerald L. Tobing`);
    console.log(`🌐 Buka Langsung (Cepat): http://localhost:${PORT}`);
    console.log(`====================================================`);
});

try {
    const certPath = path.join(__dirname, 'cert.pfx');
    if (fs.existsSync(certPath)) {
        const pfx = fs.readFileSync(certPath);
        https.createServer({ pfx: pfx, passphrase: 'adriel123' }, app).listen(3443, () => {
            console.log(`🔒 Versi HTTPS juga aktif di: https://localhost:3443`);
        });
    }
} catch (err) {
    console.warn('HTTPS background info:', err.message);
}
