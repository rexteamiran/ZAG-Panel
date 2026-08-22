import { KvSettings } from '#types/settings';

/* ==========================================================================
   Setting templates

   Ready-made configurations, so someone who does not know what a fragment or
   a fingerprint is can still get a working panel. The admin UI keeps all its
   fields; a template just fills them in.

   Each enabled template also gets its own subscription link, so a customer
   can pick between them without the operator touching anything.

   Two rules every template must obey, both learned from the cores:

   1. `fragmentMode` is never read by the worker — only the four numbers and
      `fragmentPackets` are. The admin UI's handleFragmentMode() *overwrites*
      those numbers whenever the mode is not 'custom', using the table in
      assets/panel/script.js. So a template either uses 'custom' with explicit
      numbers, or a preset whose numbers match that table exactly.

   2. Nothing here may carry a derived field (`remoteDnsHost`,
      `upstreamParams`, `chainProxyParams`) or a per-panel one
      (`customDomain`, `remoteSettings`, `panelVersion`).
   ========================================================================== */

export type TemplateSettings = Partial<Omit<KvSettings,
    | 'customDomain'
    | 'remoteSettings'
    | 'panelVersion'
    | 'remoteDnsHost'
    | 'upstreamParams'
    | 'chainProxyParams'
>>;

export type TemplateFamily = 'network' | 'performance' | 'client' | 'warp' | 'rules' | 'advanced';

export interface Localised {
    en: string;
    fa: string;
}

export interface SettingsTemplate {
    id: string;
    family: TemplateFamily;
    name: Localised;
    description: Localised;
    /** Shown before applying, when the template has a real caveat. */
    warning?: Localised;
    /** Only offered when the panel's own host ends with this. */
    requiresOrigin?: string;
    settings: TemplateSettings;
}

/**
 * Applying template B after template A must not leave A's toggles behind, so
 * every template starts from this and overrides what it cares about.
 *
 * Deliberately absent, because a template must never wipe the operator's own
 * work: customSubs, customConfigs, chainProxy, upstreamProxy, customCdnAddrs,
 * customCdnHost, customCdnSni.
 */
const BASELINE: TemplateSettings = {
    localDNS: '8.8.8.8',
    antiSanctionDNS: '178.22.122.100',
    remoteDNS: 'https://8.8.8.8/dns-query',
    fakeDNS: false,
    enableIPv6: false,
    allowLANConnection: false,
    logLevel: 'warning',
    protocols: `${_VL_},${_TR_}`,
    cleanIPs: ['www.speedtest.net'],
    ports: [443],
    fingerprint: 'chrome',
    bestPingInterval: 30,
    enableTFO: false,
    enableECH: false,
    echServerName: '',
    fragmentMode: 'custom',
    fragmentPackets: 'tlshello',
    fragmentLengthMin: 100,
    fragmentLengthMax: 200,
    fragmentDelayMin: 1,
    fragmentDelayMax: 1,
    fragmentMaxSplitMin: 0,
    fragmentMaxSplitMax: 0,
    warpRemoteDNS: '1.1.1.1',
    warpEndpoints: ['engage.cloudflareclient.com:2408'],
    warpBestPingInterval: 30,
    warpReservedBytes: true,
    xrayUdpNoises: [{ type: 'rand', packet: '50-100', delay: '1-5', count: 5 }],
    knockerNoiseMode: 'quic',
    knockerNoiseCountMin: 10,
    knockerNoiseCountMax: 15,
    knockerNoiseSizeMin: 5,
    knockerNoiseSizeMax: 10,
    knockerNoiseDelayMin: 1,
    knockerNoiseDelayMax: 1,
    amneziaNoiseCount: 5,
    amneziaNoiseSizeMin: 50,
    amneziaNoiseSizeMax: 100,
    bypassIran: false,
    bypassChina: false,
    bypassRussia: false,
    bypassOpenAi: false,
    bypassGoogleAi: false,
    bypassMicrosoft: false,
    bypassOracle: false,
    bypassDocker: false,
    bypassAdobe: false,
    bypassEpicGames: false,
    bypassIntel: false,
    bypassAmd: false,
    bypassNvidia: false,
    bypassAsus: false,
    bypassHp: false,
    bypassLenovo: false,
    blockAds: false,
    blockPorn: false,
    blockUDP443: false,
    blockMalware: false,
    blockPhishing: false,
    blockCryptominers: false,
    customBypassRules: [],
    customBlockRules: [],
    customBypassSanctionRules: []
};

/** The fragment presets the admin UI will re-apply; templates must match them. */
const FRAGMENT = {
    low: { fragmentMode: 'low', fragmentLengthMin: 100, fragmentLengthMax: 200, fragmentDelayMin: 1, fragmentDelayMax: 1 },
    medium: { fragmentMode: 'medium', fragmentLengthMin: 50, fragmentLengthMax: 100, fragmentDelayMin: 1, fragmentDelayMax: 5 },
    high: { fragmentMode: 'high', fragmentLengthMin: 10, fragmentLengthMax: 20, fragmentDelayMin: 10, fragmentDelayMax: 20 },
    severe: { fragmentMode: 'severe', fragmentLengthMin: 1, fragmentLengthMax: 5, fragmentDelayMin: 1, fragmentDelayMax: 5 }
} as const;

/** Domains that tend to sit on well-connected Cloudflare edges from Iran. */
const CLEAN_IPS = {
    small: ['www.speedtest.net', 'time.cloudflare.com'],
    wide: ['www.speedtest.net', 'time.cloudflare.com', 'ip.sb', 'www.wto.org'],
    widest: ['www.speedtest.net', 'time.cloudflare.com', 'ip.sb', 'www.wto.org', 'cf.090227.xyz']
};

const TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];

/** Iranian anti-sanction resolvers, used by the bypass* rules. */
const ANTI_SANCTION = {
    shecan: '178.22.122.100',
    electro: '78.157.42.100',
    radar: '10.202.10.10'
};

const define = (template: SettingsTemplate): SettingsTemplate => ({
    ...template,
    settings: { ...BASELINE, ...template.settings }
});

export const settingsTemplates: SettingsTemplate[] = [
    /* ---------------------------------------------------------- network -- */
    define({
        id: 'balanced-start',
        family: 'network',
        name: { en: 'Balanced Start', fa: 'شروع متعادل' },
        description: {
            en: 'The safe default. Works on most Iranian networks without tuning — start here.',
            fa: 'پیش‌فرض مطمئن. روی بیشتر شبکه‌های ایران بدون تنظیم کار می‌کند — از اینجا شروع کنید.'
        },
        settings: {
            bypassIran: true,
            cleanIPs: CLEAN_IPS.wide
        }
    }),

    define({
        id: 'mobile-data',
        family: 'network',
        name: { en: 'Mobile Data', fa: 'دیتای موبایل (ایرانسل و همراه اول)' },
        description: {
            en: 'For phone networks, which inspect traffic harder and drop long records. Smaller, slower fragments and an Android fingerprint.',
            fa: 'برای اینترنت موبایل که سخت‌گیرتر است. قطعه‌های کوچک‌تر و کندتر با اثر انگشت اندروید.'
        },
        settings: {
            fragmentMode: 'custom',
            fragmentPackets: '1-3',
            fragmentLengthMin: 40,
            fragmentLengthMax: 100,
            fragmentDelayMin: 2,
            fragmentDelayMax: 8,
            ports: [443, 8443, 2053, 2096],
            fingerprint: 'android',
            bestPingInterval: 45,
            bypassIran: true,
            blockAds: true,
            cleanIPs: CLEAN_IPS.widest
        }
    }),

    define({
        id: 'home-adsl',
        family: 'network',
        name: { en: 'Home Internet', fa: 'اینترنت خانگی (مخابرات، شاتل)' },
        description: {
            en: 'Fixed lines are steadier, so this favours speed: light fragmenting and every TLS port.',
            fa: 'خط ثابت پایدارتر است، پس سرعت در اولویت است: قطعه‌بندی سبک و همه‌ی پورت‌های TLS.'
        },
        settings: {
            ...FRAGMENT.low,
            enableTFO: true,
            remoteDNS: 'https://dns.google/dns-query',
            ports: TLS_PORTS,
            bypassIran: true,
            cleanIPs: CLEAN_IPS.wide
        }
    }),

    define({
        id: 'heavy-filtering',
        family: 'network',
        name: { en: 'Heavy Filtering', fa: 'فیلترینگ سنگین' },
        description: {
            en: 'For when it connects and then dies after a few seconds. Aggressive fragmenting and a randomised fingerprint.',
            fa: 'وقتی وصل می‌شود ولی بعد از چند ثانیه می‌افتد. قطعه‌بندی تهاجمی و اثر انگشت تصادفی.'
        },
        settings: {
            ...FRAGMENT.high,
            fragmentPackets: '1-5',
            fragmentMaxSplitMin: 2,
            fragmentMaxSplitMax: 6,
            fingerprint: 'randomized',
            bestPingInterval: 20,
            remoteDNS: 'https://94.140.14.14/dns-query',
            antiSanctionDNS: ANTI_SANCTION.electro,
            ports: TLS_PORTS,
            bypassIran: true,
            cleanIPs: CLEAN_IPS.widest
        }
    }),

    define({
        id: 'blackout',
        family: 'network',
        name: { en: 'Total Blackout', fa: 'قطعی و اختلال شدید' },
        description: {
            en: 'Nationwide disruption. The smallest fragments available, every TLS port, and the fastest node re-pick.',
            fa: 'اختلال سراسری. کوچک‌ترین قطعه‌ها، همه‌ی پورت‌های TLS و سریع‌ترین انتخاب مجدد سرور.'
        },
        settings: {
            ...FRAGMENT.severe,
            fragmentPackets: '1-1',
            fragmentMaxSplitMin: 2,
            fragmentMaxSplitMax: 4,
            fingerprint: 'randomized',
            bestPingInterval: 10,
            logLevel: 'none',
            remoteDNS: 'https://94.140.14.14/dns-query',
            antiSanctionDNS: ANTI_SANCTION.radar,
            ports: TLS_PORTS,
            bypassIran: true,
            cleanIPs: CLEAN_IPS.widest
        }
    }),

    /* ------------------------------------------------------ performance -- */
    define({
        id: 'speed-first',
        family: 'performance',
        name: { en: 'Speed First', fa: 'سرعت‌محور' },
        description: {
            en: 'When the network behaves. One port, one address pool, no rules to evaluate.',
            fa: 'وقتی شبکه خوب است. یک پورت، یک مجموعه آدرس، بدون قوانین اضافه.'
        },
        settings: {
            ...FRAGMENT.low,
            ports: [443],
            bestPingInterval: 60,
            enableTFO: true,
            logLevel: 'none',
            bypassIran: true,
            cleanIPs: CLEAN_IPS.small
        }
    }),

    define({
        id: 'gaming',
        family: 'performance',
        name: { en: 'Gaming & Low Ping', fa: 'گیمینگ و پینگ پایین' },
        description: {
            en: 'Re-picks the fastest node every ten seconds, and sends Iranian game and CDN traffic direct.',
            fa: 'هر ده ثانیه سریع‌ترین سرور را دوباره انتخاب می‌کند و ترافیک بازی و CDN ایرانی را مستقیم می‌فرستد.'
        },
        settings: {
            ...FRAGMENT.low,
            bestPingInterval: 10,
            warpBestPingInterval: 15,
            ports: [443, 8443],
            enableTFO: true,
            logLevel: 'none',
            bypassIran: true,
            customBypassRules: ['arvancloud.ir', 'derak.cloud', 'abrarvan.com']
        }
    }),

    define({
        id: 'streaming',
        family: 'performance',
        name: { en: 'Video & Streaming', fa: 'استریم و تماشای ویدیو' },
        description: {
            en: 'A wide pool for parallel connections, no switching mid-stream, and ad domains dropped.',
            fa: 'مجموعه‌ی گسترده برای اتصال موازی، بدون تعویض وسط پخش، و حذف دامنه‌های تبلیغاتی.'
        },
        settings: {
            ...FRAGMENT.low,
            ports: TLS_PORTS,
            bestPingInterval: 60,
            enableTFO: true,
            blockAds: true,
            bypassIran: true,
            cleanIPs: CLEAN_IPS.widest
        }
    }),

    define({
        id: 'light-device',
        family: 'performance',
        name: { en: 'Battery Saver', fa: 'کم‌مصرف و دستگاه ضعیف' },
        description: {
            en: 'Old phones and cheap routers: half the nodes, almost no background pinging.',
            fa: 'گوشی قدیمی و روتر ضعیف: نصف سرورها و تقریباً بدون پینگ پس‌زمینه.'
        },
        settings: {
            ...FRAGMENT.low,
            protocols: _VL_,
            ports: [443],
            bestPingInterval: 90,
            warpBestPingInterval: 90,
            logLevel: 'none',
            xrayUdpNoises: [],
            bypassIran: true
        }
    }),

    /* ----------------------------------------------------------- client -- */
    define({
        id: 'xray-classic',
        family: 'client',
        name: { en: 'v2rayNG', fa: 'وی‌تو‌ری‌ان‌جی' },
        description: {
            en: 'Tuned to what v2rayNG handles reliably: Chrome fingerprint, tlshello fragmenting, ECH off.',
            fa: 'متناسب با چیزی که v2rayNG مطمئن پشتیبانی می‌کند.'
        },
        warning: {
            en: 'With routing rules on, v2rayNG needs the Chocolate4U geo assets or configs will not connect.',
            fa: 'با قوانین روتینگ روشن، v2rayNG به فایل‌های جغرافیایی Chocolate4U نیاز دارد وگرنه وصل نمی‌شود.'
        },
        settings: {
            fingerprint: 'chrome',
            fragmentMode: 'custom',
            fragmentPackets: 'tlshello',
            bypassIran: true,
            cleanIPs: CLEAN_IPS.wide
        }
    }),

    define({
        id: 'singbox-hiddify',
        family: 'client',
        name: { en: 'Hiddify / sing-box', fa: 'هیدیفای و سینگ‌باکس' },
        description: {
            en: 'sing-box handles Fake DNS and ECH well, so both are on.',
            fa: 'سینگ‌باکس با Fake DNS و ECH خوب کار می‌کند، پس هر دو روشن است.'
        },
        warning: {
            en: 'ECH is skipped on Fragment links by design. Give customers the Normal or Raw link.',
            fa: 'ECH روی لینک Fragment اعمال نمی‌شود. لینک Normal یا Raw را بدهید.'
        },
        settings: {
            ...FRAGMENT.low,
            fakeDNS: true,
            enableECH: true,
            ports: [443, 8443, 2053, 2083],
            bypassIran: true
        }
    }),

    define({
        id: 'clash-meta',
        family: 'client',
        name: { en: 'Clash Meta / Verge', fa: 'کلش متا و ورج' },
        description: {
            en: 'Clash has no fragmenting, so it gets ECH, a 45-second node test and QUIC blocked on the WARP profile.',
            fa: 'کلش قطعه‌بندی ندارد، پس ECH و تست ۴۵ ثانیه‌ای می‌گیرد و QUIC روی وارپ بسته می‌شود.'
        },
        settings: {
            fakeDNS: true,
            enableECH: true,
            bestPingInterval: 45,
            blockUDP443: true,
            warpReservedBytes: true,
            bypassIran: true
        }
    }),

    define({
        id: 'mahsang-knocker',
        family: 'client',
        name: { en: 'MahsaNG (Knocker)', fa: 'مهسا ان‌جی' },
        description: {
            en: 'The Warp-PRO knocker noise profile MahsaNG and v2rayN-PRO expect.',
            fa: 'پروفایل نویز Knocker که مهسا ان‌جی و v2rayN-PRO انتظار دارند.'
        },
        settings: {
            knockerNoiseMode: 'quic',
            knockerNoiseCountMin: 10,
            knockerNoiseCountMax: 15,
            knockerNoiseSizeMin: 5,
            knockerNoiseSizeMax: 10,
            knockerNoiseDelayMin: 1,
            knockerNoiseDelayMax: 3,
            warpEndpoints: ['engage.cloudflareclient.com:2408', '162.159.192.1:2408', '188.114.96.1:2408'],
            warpBestPingInterval: 30,
            warpReservedBytes: true,
            bypassIran: true
        }
    }),

    /* ------------------------------------------------------------- warp -- */
    define({
        id: 'warp-standard',
        family: 'warp',
        name: { en: 'WARP Standard', fa: 'وارپ استاندارد' },
        description: {
            en: 'Cloudflare WARP with three endpoints. A good fallback when the proxy path is dead.',
            fa: 'وارپ کلادفلر با سه نقطه اتصال. جایگزین خوبی وقتی مسیر پروکسی از کار افتاده.'
        },
        settings: {
            warpEndpoints: ['engage.cloudflareclient.com:2408', '162.159.192.1:2408', '188.114.96.1:2408'],
            warpRemoteDNS: '1.1.1.1',
            warpBestPingInterval: 30,
            warpReservedBytes: true,
            bypassIran: true
        }
    }),

    define({
        id: 'warp-pro-amnezia',
        family: 'warp',
        name: { en: 'WARP Pro (Amnezia)', fa: 'وارپ حرفه‌ای (آمنزیا)' },
        description: {
            en: 'Heavier obfuscation for Amnezia and WG Tunnel: junk packets and randomised noise.',
            fa: 'استتار سنگین‌تر برای آمنزیا و WG Tunnel: بسته‌های زائد و نویز تصادفی.'
        },
        settings: {
            amneziaNoiseCount: 8,
            amneziaNoiseSizeMin: 40,
            amneziaNoiseSizeMax: 120,
            knockerNoiseMode: 'random',
            knockerNoiseCountMin: 12,
            knockerNoiseCountMax: 20,
            knockerNoiseSizeMin: 10,
            knockerNoiseSizeMax: 40,
            knockerNoiseDelayMin: 1,
            knockerNoiseDelayMax: 5,
            warpEndpoints: ['engage.cloudflareclient.com:2408', '162.159.192.1:2408', '188.114.96.1:2408'],
            warpBestPingInterval: 20,
            warpReservedBytes: true,
            blockUDP443: true,
            xrayUdpNoises: [
                { type: 'rand', packet: '50-100', delay: '1-5', count: 5 },
                { type: 'rand', packet: '10-30', delay: '5-10', count: 3 }
            ],
            bypassIran: true
        }
    }),

    /* ------------------------------------------------------------ rules -- */
    define({
        id: 'family-safe',
        family: 'rules',
        name: { en: 'Family Safe', fa: 'خانواده (کودک‌ایمن)' },
        description: {
            en: 'Adult sites, ads, malware and phishing blocked in the tunnel and at the resolver.',
            fa: 'سایت‌های بزرگسال، تبلیغات، بدافزار و فیشینگ هم در تونل و هم در DNS بسته می‌شوند.'
        },
        warning: {
            en: 'Routing rules need the right geo assets in some clients.',
            fa: 'قوانین روتینگ در بعضی کلاینت‌ها به فایل‌های جغرافیایی نیاز دارند.'
        },
        settings: {
            ...FRAGMENT.low,
            blockPorn: true,
            blockAds: true,
            blockMalware: true,
            blockPhishing: true,
            remoteDNS: 'https://94.140.14.15/dns-query',
            bypassIran: true
        }
    }),

    define({
        id: 'adfree-secure',
        family: 'rules',
        name: { en: 'Ad-free & Secure', fa: 'بدون تبلیغات و امن' },
        description: {
            en: 'Ads, malware, phishing and crypto-miners blocked, with Quad9 upstream.',
            fa: 'تبلیغات، بدافزار، فیشینگ و ماینر بسته می‌شوند، با DNS کواد۹.'
        },
        warning: {
            en: 'Routing rules need the right geo assets in some clients.',
            fa: 'قوانین روتینگ در بعضی کلاینت‌ها به فایل‌های جغرافیایی نیاز دارند.'
        },
        settings: {
            ...FRAGMENT.low,
            blockAds: true,
            blockMalware: true,
            blockPhishing: true,
            blockCryptominers: true,
            remoteDNS: 'https://9.9.9.9/dns-query',
            bypassIran: true
        }
    }),

    define({
        id: 'ai-sanctions',
        family: 'rules',
        name: { en: 'AI & Sanctioned Sites', fa: 'هوش مصنوعی و تحریم‌شکن' },
        description: {
            en: 'ChatGPT, Claude, Gemini and friends go direct through an Iranian resolver — usually the only way they answer at all.',
            fa: 'ChatGPT و Claude و Gemini مستقیم از DNS ایرانی رد می‌شوند — معمولاً تنها راه جواب گرفتن.'
        },
        warning: {
            en: 'Depends on a working anti-sanction DNS. If Shecan is blocked for you, try Electro (78.157.42.100).',
            fa: 'به DNS تحریم‌شکن سالم وابسته است. اگر شکن کار نکرد، الکترو را امتحان کنید.'
        },
        settings: {
            ...FRAGMENT.low,
            bypassOpenAi: true,
            bypassGoogleAi: true,
            antiSanctionDNS: ANTI_SANCTION.shecan,
            bypassIran: true,
            customBypassSanctionRules: [
                'openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com',
                'gemini.google.com', 'aistudio.google.com', 'perplexity.ai',
                'x.ai', 'grok.com', 'cursor.com', 'copilot.microsoft.com', 'huggingface.co'
            ]
        }
    }),

    define({
        id: 'developer',
        family: 'rules',
        name: { en: 'Developer', fa: 'میزکار برنامه‌نویس' },
        description: {
            en: 'GitHub, npm, PyPI, Docker Hub and the rest pinned to an anti-sanction resolver. LAN access on for containers.',
            fa: 'گیت‌هاب، npm، PyPI، داکر و بقیه به DNS تحریم‌شکن وصل می‌شوند. دسترسی شبکه محلی برای کانتینرها روشن است.'
        },
        warning: {
            en: 'Routing rules need the right geo assets in some clients.',
            fa: 'قوانین روتینگ در بعضی کلاینت‌ها به فایل‌های جغرافیایی نیاز دارند.'
        },
        settings: {
            ...FRAGMENT.low,
            bypassMicrosoft: true,
            bypassOracle: true,
            bypassDocker: true,
            bypassAdobe: true,
            bypassIntel: true,
            bypassAmd: true,
            bypassNvidia: true,
            bypassAsus: true,
            bypassHp: true,
            bypassLenovo: true,
            bypassOpenAi: true,
            bypassGoogleAi: true,
            antiSanctionDNS: ANTI_SANCTION.shecan,
            allowLANConnection: true,
            bypassIran: true,
            customBypassSanctionRules: [
                'github.com', 'githubusercontent.com', 'registry.npmjs.org', 'npmjs.com',
                'pypi.org', 'files.pythonhosted.org', 'registry-1.docker.io', 'docker.io',
                'nuget.org', 'repo1.maven.org', 'proxy.golang.org', 'crates.io',
                'jetbrains.com', 'visualstudio.com', 'gradle.org', 'flutter.dev',
                'developer.android.com'
            ]
        }
    }),

    define({
        id: 'iran-direct',
        family: 'rules',
        name: { en: 'Iran Direct', fa: 'عبور مستقیم ایران' },
        description: {
            en: 'Iranian banking, shopping and government sites never enter the tunnel — faster, and Shaparak actually works.',
            fa: 'بانک و خرید و سایت‌های دولتی ایران وارد تونل نمی‌شوند — سریع‌تر، و شاپرک واقعاً کار می‌کند.'
        },
        settings: {
            ...FRAGMENT.low,
            bypassIran: true,
            localDNS: ANTI_SANCTION.shecan,
            customBypassRules: [
                'shaparak.ir', 'sep.shaparak.ir', 'sadad.shaparak.ir', 'bmi.ir',
                'bankmellat.ir', 'digikala.com', 'snapp.ir', 'tapsi.ir', 'aparat.com',
                'divar.ir', 'cafebazaar.ir', 'myket.ir', 'irancell.ir', 'mci.ir',
                'tci.ir', 'arvancloud.ir', 'derak.cloud'
            ]
        }
    }),

    /* --------------------------------------------------------- advanced -- */
    define({
        id: 'ech-stealth',
        family: 'advanced',
        name: { en: 'ECH Stealth', fa: 'استتار ECH' },
        description: {
            en: 'Encrypted Client Hello hides the site name entirely.',
            fa: 'ECH نام سایت را کاملاً پنهان می‌کند.'
        },
        warning: {
            en: 'ECH is skipped on Fragment links by design. Give customers the Normal or Raw link.',
            fa: 'ECH روی لینک Fragment اعمال نمی‌شود. لینک Normal یا Raw را بدهید.'
        },
        settings: {
            enableECH: true,
            echServerName: 'cloudflare-ech.com',
            ports: [443],
            fingerprint: 'chrome',
            bypassIran: true
        }
    }),

    define({
        id: 'non-tls-ports',
        family: 'advanced',
        name: { en: 'Non-TLS Ports', fa: 'پورت‌های بدون TLS' },
        description: {
            en: 'When the ISP throttles 443 on a workers.dev panel, this adds the plain-HTTP ports alongside it.',
            fa: 'وقتی اپراتور پورت ۴۴۳ را کند می‌کند، پورت‌های HTTP ساده را هم اضافه می‌کند.'
        },
        warning: {
            en: 'These ports carry no encryption at the edge. Only for workers.dev panels.',
            fa: 'این پورت‌ها رمزگذاری لبه ندارند. فقط برای پنل‌های workers.dev.'
        },
        requiresOrigin: 'workers.dev',
        settings: {
            ...FRAGMENT.low,
            ports: [443, 80, 8080, 8880, 2052, 2082, 2086, 2095],
            bypassIran: true
        }
    }),

    define({
        id: 'chain-ready',
        family: 'advanced',
        name: { en: 'Chain Proxy Ready', fa: 'آماده‌ی پروکسی زنجیره‌ای' },
        description: {
            en: 'A clean single-hop configuration so a second hop of your own is not fought by fragmenting.',
            fa: 'پیکربندی تمیز تک‌مرحله‌ای تا پرش دوم شما با قطعه‌بندی درگیر نشود.'
        },
        warning: {
            en: 'Clears the chain and upstream proxy fields. Paste yours in afterwards, then press Apply.',
            fa: 'فیلدهای پروکسی زنجیره‌ای و بالادست را خالی می‌کند. بعد مال خودتان را وارد کنید.'
        },
        settings: {
            ...FRAGMENT.low,
            chainProxy: '',
            upstreamProxy: '',
            ports: [443],
            bestPingInterval: 60,
            enableTFO: true,
            enableECH: false,
            bypassIran: true
        }
    }),

    define({
        id: 'diagnostics',
        family: 'advanced',
        name: { en: 'Diagnostics', fa: 'عیب‌یابی' },
        description: {
            en: 'Every rule off and debug logging on, so a problem can be traced without routing rules in the way.',
            fa: 'همه‌ی قوانین خاموش و لاگ کامل روشن، تا مشکل بدون دخالت قوانین ردیابی شود.'
        },
        warning: {
            en: 'Debug logging is verbose and records hostnames in the client log. Switch back when done.',
            fa: 'لاگ کامل پرحجم است و نام سایت‌ها را ثبت می‌کند. بعد از عیب‌یابی برگردانید.'
        },
        settings: {
            logLevel: 'debug',
            ports: TLS_PORTS,
            fragmentMode: 'custom',
            fragmentPackets: 'tlshello'
        }
    })
];

export const templateById = (id: string): SettingsTemplate | undefined =>
    settingsTemplates.find(template => template.id === id);
