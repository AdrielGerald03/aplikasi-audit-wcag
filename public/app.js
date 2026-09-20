document.addEventListener('DOMContentLoaded', () => {
    const auditForm = document.getElementById('auditForm');
    const urlInput = document.getElementById('urlInput');
    const btnAudit = document.getElementById('btnAudit');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');
    const resultSection = document.getElementById('resultSection');

    const sampleBtns = document.querySelectorAll('.sample-btn');
    const btnPrint = document.getElementById('btnPrint');

    // Simulator Elements
    const previewFrame = document.getElementById('previewFrame');
    const visionButtons = document.querySelectorAll('.v-btn');
    const activeVisionMode = document.getElementById('activeVisionMode');

    // Quick samples
    sampleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            urlInput.value = btn.getAttribute('data-url');
            auditForm.dispatchEvent(new Event('submit'));
        });
    });

    // Color vision filter buttons
    visionButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            visionButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filterType = btn.getAttribute('data-filter');
            if (filterType !== 'normal') {
                previewFrame.classList.add(`filter-${filterType}`);
            }
        });
    });

    // Simulator Controls
    const btnReloadSim = document.getElementById('btnReloadSim');
    const btnDirectPreview = document.getElementById('btnDirectPreview');

    if (btnReloadSim) {
        btnReloadSim.addEventListener('click', () => {
            if (previewFrame.src) previewFrame.src = previewFrame.src;
        });
    }
    // Filter Pills Isu
    let currentAuditData = null;
    const filterPills = document.querySelectorAll('.filter-pill');
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const filterVal = pill.getAttribute('data-filter');
            if (currentAuditData) renderIssues(currentAuditData.issues, filterVal);
        });
    });

    // Ekspor Data Laporan JSON
    const btnExportJson = document.getElementById('btnExportJson');
    if (btnExportJson) {
        btnExportJson.addEventListener('click', () => {
            if (!currentAuditData) return;
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentAuditData, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `audit-wcag-${new Date().getTime()}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });
    }

    // Cetak Laporan PDF

    // Smart auto-formatter URL: default https:// (Secure)
    function formatUrl(input) {
        let trimmed = input.trim();
        if (!trimmed) return '';
        if (!trimmed.includes('.') && !trimmed.startsWith('http')) {
            trimmed = trimmed + '.com';
        }
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            trimmed = 'https://' + trimmed;
        }
        return trimmed;
    }

    // Submit Form Audit
    auditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rawUrl = urlInput.value.trim();
        if (!rawUrl) return;

        const cleanUrl = formatUrl(rawUrl);
        urlInput.value = cleanUrl;

        btnText.textContent = 'Mengeksekusi Engine P.O.U.R...';
        btnLoader.style.display = 'inline-block';
        btnAudit.disabled = true;

        try {
            const response = await fetch('/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: cleanUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                alert(data.error || 'Gagal mengevaluasi situs web. Pastikan alamat URL benar.');
                return;
            }

            renderFullAcademicReport(data);

            // Muat preview simulator via injeksi srcdoc langsung
            try {
                const proxyUrl = `/api/preview?url=${encodeURIComponent(data.url)}`;
                if (btnDirectPreview) btnDirectPreview.href = proxyUrl;
                
                const previewRes = await fetch(proxyUrl);
                const previewHtml = await previewRes.text();
                previewFrame.srcdoc = previewHtml;
            } catch (errPrev) {
                console.warn('Gagal memuat pratinjau:', errPrev);
            }

        } catch (err) {
            console.error(err);
            alert('Gagal menghubungi server audit di laptop.');
        } finally {
            btnText.textContent = 'Jalankan Audit P.O.U.R';
            btnLoader.style.display = 'none';
            btnAudit.disabled = false;
        }
    });

    function renderFullAcademicReport(data) {
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth' });

        // Header & Ringkasan Eksekutif
        document.getElementById('targetUrlDisplay').textContent = data.url;
        document.getElementById('executiveSummary').textContent = data.summary.insight;
        document.getElementById('conformanceBadge').textContent = data.summary.conformance;
        document.getElementById('auditTime').textContent = data.timestamp;
        document.getElementById('totalElements').textContent = `${data.summary.stats.totalImages} gambar, ${data.summary.stats.totalLinks} link, ${data.summary.stats.totalInputs} input, ${data.summary.stats.totalHeadings} heading`;

        // Skor & Grade
        const score = data.summary.score;
        document.getElementById('scoreNumber').textContent = score;

        const gradeBadge = document.getElementById('gradeBadge');
        gradeBadge.textContent = `Grade ${data.summary.grade}`;
        gradeBadge.className = `grade-badge grade-${data.summary.grade.toLowerCase()}`;

        // 🌟 4 PILAR WCAG P.O.U.R PROGRESS BARS
        const pour = data.summary.pourAnalysis;
        setPourBar('pourPVal', 'pourPBar', pour.perceivable);
        setPourBar('pourOVal', 'pourOBar', pour.operable);
        setPourBar('pourUVal', 'pourUBar', pour.understandable);
        setPourBar('pourRVal', 'pourRBar', pour.robust);

        // 🌟 Grid Kontras Warna W3C
        const contrastGrid = document.getElementById('contrastGrid');
        contrastGrid.innerHTML = '';

        if (data.contrastAnalysis && data.contrastAnalysis.length > 0) {
            data.contrastAnalysis.forEach(item => {
                const card = document.createElement('div');
                card.className = 'contrast-card';
                card.innerHTML = `
                    <div class="contrast-preview" style="color: ${item.textColor}; background-color: ${item.bgColor};">
                        "${item.sampleText}"
                    </div>
                    <div class="contrast-meta">
                        <span>Tag: &lt;${item.element}&gt;</span>
                        <span class="contrast-ratio-badge ${item.isPassed ? 'ratio-pass' : 'ratio-fail'}">
                            Rasio ${item.ratio}:1 (${item.level})
                        </span>
                    </div>
                `;
                contrastGrid.appendChild(card);
            });
        }

        currentAuditData = data;
        renderIssues(data.issues, 'all');

        // Render Kriteria Lolos
        const passedList = document.getElementById('passedList');
        passedList.innerHTML = '';

        data.passed.forEach(item => {
            const card = document.createElement('div');
            card.className = 'passed-card';
            card.innerHTML = `
                <div class="passed-header">
                    <span class="passed-title-text">${item.title}</span>
                    <span class="issue-code">${item.code} • ${item.pillar}</span>
                </div>
                <div class="passed-desc">${item.description}</div>
            `;
            passedList.appendChild(card);
        });
    }

    function renderIssues(allIssues, filterVal) {
        const issuesList = document.getElementById('issuesList');
        if (!issuesList) return;
        issuesList.innerHTML = '';

        const filtered = (filterVal === 'all') 
            ? allIssues 
            : allIssues.filter(i => i.severity === filterVal);

        if (filtered.length === 0) {
            issuesList.innerHTML = `
                <div class="passed-card">
                    <p style="color: #065f46; font-weight: 700;">Tidak ada pelanggaran untuk kategori tingkat "${filterVal}".</p>
                </div>
            `;
            return;
        }

        filtered.forEach(issue => {
            const card = document.createElement('div');
            card.className = `issue-card severity-${issue.severity}`;
            card.innerHTML = `
                <div class="issue-header">
                    <span class="issue-code">${issue.code} • Pilar: ${issue.pillar}</span>
                    <span class="severity-tag tag-${issue.severity}">${issue.severity}</span>
                </div>
                <div class="issue-title">${issue.title}</div>
                <div class="issue-impact">⚠️ Dampak Disabilitas: ${issue.impact}</div>
                <p style="font-size: 14px; color: #334155; margin-bottom: 8px;"><strong>Rekomendasi W3C:</strong> ${issue.recommendation}</p>
                
                <div class="code-diff-container">
                    <div class="diff-box diff-bad">
                        <div class="diff-title">❌ Kode Saat Ini (Bermasalah)</div>
                        <code>${escapeHtml(issue.codeSnippet)}</code>
                    </div>
                    <div class="diff-box diff-good">
                        <div class="diff-title">✅ Kode Perbaikan (Ramah Disabilitas)</div>
                        <code>${escapeHtml(issue.fixSnippet)}</code>
                    </div>
                </div>
            `;
            issuesList.appendChild(card);
        });
    }

    function setPourBar(valId, barId, pct) {
        document.getElementById(valId).textContent = `${pct}%`;
        const bar = document.getElementById(barId);
        bar.style.width = `${pct}%`;
        if (pct < 50) bar.style.backgroundColor = '#ef4444';
        else if (pct < 80) bar.style.backgroundColor = '#f59e0b';
        else bar.style.backgroundColor = '#10b981';
    }

    function escapeHtml(string) {
        return String(string)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
});
