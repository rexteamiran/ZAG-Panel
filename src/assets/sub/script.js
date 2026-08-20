/* ZAGROOO subscriber portal */

const DATA = JSON.parse(document.getElementById('portal-data').textContent || '{}');

const I18N = {
    en: {
        theme: 'Theme',
        navOverview: 'Overview',
        navLinks: 'Links',
        navApps: 'Apps',
        navRaw: 'Raw',
        quickAccess: 'Quick access',
        quickAccessHint: 'A short view of your subscription status.',
        statStatus: 'Status',
        statTotal: 'Total usage',
        statDaily: 'Daily usage',
        statExpiry: 'Expires',
        localTime: 'Local time',
        autoLink: 'Automatic link',
        autoLinkHint: 'This link detects your client and serves the best format.',
        recommended: 'RECOMMENDED',
        copy: 'Copy',
        usageHistory: 'Usage history',
        linksHint: 'Pick the subscription that matches your client.',
        appsHint: 'Supported clients and their minimum versions.',
        rawHint: 'The raw subscription payload, for manual import.',
        tabUsage: 'Usage',
        tabDetails: 'Details',
        meterTotal: 'Total',
        meterDaily: 'Daily',
        quotaTotal: 'Total quota',
        detailDown: 'Download cap',
        detailUp: 'Upload cap',
        detailDevices: 'Devices',
        detailUpdated: 'Updated',
        unlimited: 'Unlimited',
        never: 'Never',
        noUsage: 'No usage recorded yet.',
        lastDays: 'Last {n} days',
        total: 'Total: {v}',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        statusActive: 'Active',
        statusPaused: 'Paused',
        statusExpired: 'Expired',
        statusLimited: 'Limit reached',
        'statusDaily-limited': 'Daily limit reached',
        minVersion: 'min {v}'
    },
    fa: {
        theme: 'پوسته',
        navOverview: 'نمای کلی',
        navLinks: 'لینک‌ها',
        navApps: 'برنامه‌ها',
        navRaw: 'خام',
        quickAccess: 'دسترسی سریع',
        quickAccessHint: 'نمای کوتاهی از وضعیت اشتراک شما.',
        statStatus: 'وضعیت',
        statTotal: 'مصرف کل',
        statDaily: 'مصرف روزانه',
        statExpiry: 'تاریخ انقضا',
        localTime: 'زمان محلی',
        autoLink: 'لینک خودکار',
        autoLinkHint: 'این لینک کلاینت شما را شناسایی و بهترین فرمت را ارسال می‌کند.',
        recommended: 'پیشنهادی',
        copy: 'کپی',
        usageHistory: 'تاریخچه مصرف',
        linksHint: 'لینک متناسب با کلاینت خود را انتخاب کنید.',
        appsHint: 'کلاینت‌های پشتیبانی‌شده و حداقل نسخه.',
        rawHint: 'محتوای خام اشتراک، برای وارد کردن دستی.',
        tabUsage: 'مصرف',
        tabDetails: 'جزئیات',
        meterTotal: 'مصرف کل',
        meterDaily: 'مصرف روزانه',
        quotaTotal: 'سهمیه کل',
        detailDown: 'سقف دانلود',
        detailUp: 'سقف آپلود',
        detailDevices: 'دستگاه‌ها',
        detailUpdated: 'آخرین بروزرسانی',
        unlimited: 'نامحدود',
        never: 'بدون انقضا',
        noUsage: 'هنوز مصرفی ثبت نشده است.',
        lastDays: '{n} روز اخیر',
        total: 'مجموع: {v}',
        copied: 'کپی شد',
        copyFailed: 'کپی نشد',
        statusActive: 'فعال',
        statusPaused: 'متوقف',
        statusExpired: 'منقضی',
        statusLimited: 'اتمام حجم',
        'statusDaily-limited': 'اتمام حجم روزانه',
        minVersion: 'حداقل {v}'
    }
};

let lang = safeStorage('zag-lang') || 'fa';
let chartDays = 7;

function safeStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function store(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        /* storage blocked */
    }
}

function t(key, vars) {
    let text = (I18N[lang] && I18N[lang][key]) || (I18N.en[key] ?? key);
    if (vars) {
        Object.keys(vars).forEach(name => {
            text = text.replace(`{${name}}`, vars[name]);
        });
    }
    return text;
}

function formatBytes(bytes) {
    if (!bytes) return '0.00 GB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, exponent)).toFixed(2)} ${units[exponent]}`;
}

function formatSpeed(kbps) {
    return kbps ? `${kbps} KB/s` : t('unlimited');
}

function formatDate(ms) {
    if (!ms) return t('never');
    const date = new Date(ms);
    const locale = lang === 'fa' ? 'fa-IR' : 'en-GB';
    return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB');
}

function percent(used, limit) {
    if (!limit) return 0;
    return Math.min(100, (used / limit) * 100);
}

function barClass(pct) {
    if (pct >= 95) return 'bar is-danger';
    if (pct >= 80) return 'bar is-warn';
    return 'bar';
}

/* ==========================================================================
   Rendering
   ========================================================================== */

function applyLanguage() {
    const root = document.documentElement;
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    document.getElementById('lang-label').textContent = lang === 'fa' ? 'FA' : 'EN';

    document.querySelectorAll('[data-i18n]').forEach(node => {
        node.textContent = t(node.dataset.i18n);
    });

    render();
}

function statusPill(node, status) {
    node.textContent = t(`status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
    node.className = 'pill';
    if (status === 'paused' || status === 'expired') node.classList.add('is-danger');
    if (status === 'limited' || status === 'daily-limited') node.classList.add('is-warn');
}

function render() {
    const { limits, usage, status, name, uuid, links, apps, devices } = DATA;

    document.title = `${name || 'ZAGROOO'} — ZAGROOO`;
    document.getElementById('user-name').textContent = name || 'ZAGROOO';
    document.getElementById('user-initial').textContent = (name || 'Z').charAt(0).toUpperCase();
    document.getElementById('detail-name').textContent = name || 'ZAGROOO';
    document.getElementById('detail-uuid').textContent = uuid || '—';

    statusPill(document.getElementById('stat-status'), status);
    statusPill(document.getElementById('detail-status'), status);
    document.getElementById('stat-status-icon').textContent = status === 'active' ? '✓' : '!';

    document.getElementById('stat-total').textContent = formatBytes(usage.total);
    document.getElementById('stat-total-limit').textContent =
        limits.limitTotalBytes ? `/ ${formatBytes(limits.limitTotalBytes)}` : t('unlimited');

    document.getElementById('stat-daily').textContent = formatBytes(usage.daily);
    document.getElementById('stat-daily-limit').textContent =
        limits.limitDailyBytes ? `/ ${formatBytes(limits.limitDailyBytes)}` : t('unlimited');

    document.getElementById('stat-expiry').textContent = formatDate(limits.expireAt);

    document.getElementById('auto-link').value = links.auto;
    document.getElementById('raw-link').value = links.raw;

    // meters
    const totalPct = percent(usage.total, limits.limitTotalBytes);
    const dailyPct = percent(usage.daily, limits.limitDailyBytes);

    document.getElementById('meter-total-text').textContent =
        limits.limitTotalBytes ? `${formatBytes(usage.total)} / ${formatBytes(limits.limitTotalBytes)}` : formatBytes(usage.total);
    const totalBar = document.getElementById('meter-total-bar');
    totalBar.style.width = `${limits.limitTotalBytes ? totalPct : 0}%`;
    totalBar.className = barClass(totalPct);
    document.getElementById('meter-total-pct').textContent =
        limits.limitTotalBytes ? `${totalPct.toFixed(1)}%` : t('unlimited');

    document.getElementById('meter-daily-text').textContent =
        limits.limitDailyBytes ? `${formatBytes(usage.daily)} / ${formatBytes(limits.limitDailyBytes)}` : formatBytes(usage.daily);
    const dailyBar = document.getElementById('meter-daily-bar');
    dailyBar.style.width = `${limits.limitDailyBytes ? dailyPct : 0}%`;
    dailyBar.className = barClass(dailyPct);
    document.getElementById('meter-daily-pct').textContent =
        limits.limitDailyBytes ? `${dailyPct.toFixed(1)}%` : t('unlimited');

    const quotaBar = document.getElementById('quota-bar');
    quotaBar.style.width = `${limits.limitTotalBytes ? totalPct : 0}%`;
    quotaBar.className = barClass(totalPct);
    document.getElementById('quota-pct').textContent =
        limits.limitTotalBytes ? `${totalPct.toFixed(1)}%` : t('unlimited');
    document.getElementById('quota-value').textContent =
        limits.limitTotalBytes
            ? `${formatBytes(usage.total)} / ${formatBytes(limits.limitTotalBytes)}`
            : formatBytes(usage.total);

    // details
    document.getElementById('detail-down').textContent = formatSpeed(limits.downSpeedKbps);
    document.getElementById('detail-up').textContent = formatSpeed(limits.upSpeedKbps);
    document.getElementById('detail-devices').textContent =
        limits.maxDevices ? `${devices} / ${limits.maxDevices}` : `${devices} · ${t('unlimited')}`;
    document.getElementById('detail-updated').textContent = formatDateTime(usage.updatedAt);

    renderChart();
    renderLinks(links.subscriptions);
    renderApps(apps);
}

function renderChart() {
    const container = document.getElementById('chart');
    const series = (DATA.usage.history || []).slice(-chartDays);
    const sum = series.reduce((acc, entry) => acc + entry.b, 0);
    const peak = Math.max(...series.map(entry => entry.b), 1);

    document.getElementById('chart-range').textContent = t('lastDays', { n: chartDays });
    document.getElementById('chart-total').textContent = t('total', { v: formatBytes(sum) });

    if (!sum) {
        container.innerHTML = `<div class="chart-empty">${t('noUsage')}</div>`;
        return;
    }

    container.innerHTML = series.map(entry => {
        const height = Math.max(2, (entry.b / peak) * 100);
        const cls = entry.b ? 'chart-bar' : 'chart-bar is-empty';
        return `<div class="chart-col" title="${entry.d} — ${formatBytes(entry.b)}">
            <span class="${cls}" style="height:${height}%"></span>
        </div>`;
    }).join('');
}

function renderLinks(subs) {
    const list = document.getElementById('links-list');
    list.innerHTML = (subs || []).map(sub => `
        <div class="panel">
            <div class="link-card-head">
                <strong>${sub.type} · ${sub.core}</strong>
                <span class="link-clients">${sub.clients.join(' · ')}</span>
            </div>
            <div class="link-row">
                <input type="text" readonly value="${sub.url}" />
                <button class="btn btn-accent" data-copy-value="${sub.url}" type="button">${t('copy')}</button>
                <button class="btn btn-ghost" data-qr="${sub.url}" type="button">▦</button>
            </div>
        </div>
    `).join('');
}

function renderApps(apps) {
    const grid = document.getElementById('apps-list');
    grid.innerHTML = (apps || []).map(app => `
        <div class="app-card">
            <strong>${app.name}</strong>
            <span>${t('minVersion', { v: app.minVer })}</span>
            <a href="${app.url}" target="_blank" rel="noopener noreferrer">${app.source} ↗</a>
        </div>
    `).join('');
}

/* ==========================================================================
   Interaction
   ========================================================================== */

let toastTimer = 0;

function toast(message) {
    const node = document.getElementById('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 1800);
}

async function copy(value) {
    try {
        await navigator.clipboard.writeText(value);
        toast(t('copied'));
    } catch (error) {
        toast(t('copyFailed'));
    }
}

function showQr(value) {
    document.getElementById('qr-image').src = `${DATA.links.qrEndpoint}?data=${encodeURIComponent(value)}`;
    document.getElementById('qr-modal').hidden = false;
}

document.addEventListener('click', event => {
    const target = event.target;

    const copyTarget = target.closest('[data-copy]');
    if (copyTarget) {
        copy(document.querySelector(copyTarget.dataset.copy).value);
        return;
    }

    const copyValue = target.closest('[data-copy-value]');
    if (copyValue) {
        copy(copyValue.dataset.copyValue);
        return;
    }

    if (target.closest('#auto-qr')) {
        showQr(document.getElementById('auto-link').value);
        return;
    }

    const qrTarget = target.closest('[data-qr]');
    if (qrTarget) {
        showQr(qrTarget.dataset.qr);
        return;
    }

    if (target.closest('#qr-close') || target.id === 'qr-modal') {
        document.getElementById('qr-modal').hidden = true;
        return;
    }

    const railItem = target.closest('.rail-item');
    if (railItem) {
        document.querySelectorAll('.rail-item').forEach(node => node.classList.remove('is-active'));
        railItem.classList.add('is-active');
        document.querySelectorAll('.view').forEach(node => {
            node.classList.toggle('is-active', node.dataset.view === railItem.dataset.view);
        });
        return;
    }

    const tab = target.closest('.tab');
    if (tab) {
        document.querySelectorAll('.tab').forEach(node => node.classList.remove('is-active'));
        tab.classList.add('is-active');
        document.querySelectorAll('.tab-panel').forEach(node => {
            node.classList.toggle('is-active', node.dataset.tab === tab.dataset.tab);
        });
        return;
    }

    const range = target.closest('.range');
    if (range) {
        chartDays = parseInt(range.dataset.days, 10);
        document.querySelectorAll('.range').forEach(node => node.classList.remove('is-active'));
        range.classList.add('is-active');
        renderChart();
        return;
    }

    if (target.closest('#lang-toggle')) {
        lang = lang === 'fa' ? 'en' : 'fa';
        store('zag-lang', lang);
        applyLanguage();
        return;
    }

    if (target.closest('#theme-toggle')) {
        const isDark = document.documentElement.classList.toggle('dark');
        store('zag-theme', isDark ? 'dark' : 'light');
    }
});

applyLanguage();
