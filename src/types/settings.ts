export interface KvSettings {
    localDNS: string;
    antiSanctionDNS: string;
    fakeDNS: boolean;
    enableIPv6: boolean;
    allowLANConnection: boolean;
    logLevel: LogLevel;
    customDomain: string;
    remoteDNS: string;
    remoteDnsHost: DnsHost;
    upstreamProxy: string;
    upstreamParams: UpstreamProxy;
    chainProxy: string;
    chainProxyParams: any;
    cleanIPs: string[];
    customCdnAddrs: string[];
    customCdnHost: string;
    customCdnSni: string;
    bestPingInterval: number;
    protocols: string;
    ports: number[];
    fingerprint: Fingerprint;
    enableTFO: boolean;
    fragmentMode: FragmentMode;
    fragmentLengthMin: number;
    fragmentLengthMax: number;
    fragmentDelayMin: number;
    fragmentDelayMax: number;
    fragmentPackets: FragmentPacket;
    fragmentMaxSplitMin?: number;
    fragmentMaxSplitMax?: number;
    enableECH: boolean;
    echServerName: string;
    bypassIran: boolean;
    bypassChina: boolean;
    bypassRussia: boolean;
    bypassOpenAi: boolean;
    bypassGoogleAi: boolean;
    bypassMicrosoft: boolean;
    bypassOracle: boolean;
    bypassDocker: boolean;
    bypassAdobe: boolean;
    bypassEpicGames: boolean;
    bypassIntel: boolean;
    bypassAmd: boolean;
    bypassNvidia: boolean;
    bypassAsus: boolean;
    bypassHp: boolean;
    bypassLenovo: boolean;
    blockAds: boolean;
    blockPorn: boolean;
    blockUDP443: boolean;
    blockMalware: boolean;
    blockPhishing: boolean;
    blockCryptominers: boolean;
    customBypassRules: string[];
    customBlockRules: string[];
    customBypassSanctionRules: string[];
    warpRemoteDNS: string;
    warpEndpoints: string[];
    warpBestPingInterval: number;
    warpReservedBytes: boolean;
    xrayUdpNoises: XrUdpNoise[];
    knockerNoiseMode: string;
    knockerNoiseCountMin: number;
    knockerNoiseCountMax: number;
    knockerNoiseSizeMin: number;
    knockerNoiseSizeMax: number;
    knockerNoiseDelayMin: number;
    knockerNoiseDelayMax: number;
    amneziaNoiseCount: number;
    amneziaNoiseSizeMin: number;
    amneziaNoiseSizeMax: number;
    customSubs: string[];
    customConfigs: string[];
    remoteSettings: string;
    panelVersion: string;
}

export interface TelegramBot {
    telegramBotToken: string;
    telegramUserId: string;
}

export interface EmbededSettings {
    accID: string;
    accEmail: string;
    apiToken: string;
    vlUUID: string;
    trPass: string;
    securePath: string;
    proxyIpMode: string;
    proxyIPs: string[];
    prefixes: string[];
    fallback: string;
    dohUrl: string;
    mainDomain: string;
    deployType?: string;
}

export interface MainSettings extends Omit<EmbededSettings,
    | 'accID'
    | 'apiToken'
    | 'accEmail'
    | 'mainDomain'
> { }

export interface SharedSettings extends
    Pick<EmbededSettings,
        | 'proxyIpMode'
        | 'proxyIPs'
        | 'prefixes'
        | 'fallback'
        | 'dohUrl'
    >,
    Omit<KvSettings,
        | 'remoteSettings'
        | 'customDomain'
        | 'panelVersion'
    > { }

export interface PanelSettings extends KvSettings, MainSettings { };
export interface ReqSettings {
    httpPorts: number[];
    httpsPorts: number[];
    client: string;
    origin: string;
    pathname: string;
    hostname: string;
    searchParams: URLSearchParams;
}

export type LogLevel = 'none' | 'warning' | 'error' | 'info' | 'debug';
export type FragmentMode = 'custom' | 'low' | 'medium' | 'high';
export type FragmentPacket = 'tlshello' | '1-1' | '1-2' | '1-3' | '1-5';
export type Fingerprint =
    | 'chrome'
    | 'firefox'
    | 'safari'
    | 'ios'
    | 'android'
    | 'edge'
    | '360'
    | 'qq'
    | 'random'
    | 'randomized';

export interface UpstreamProxy {
    upstreamServer?: string;
    upstreamPort?: number;
}

export interface DnsHost {
    host: string;
    isDomain: boolean;
    ipv4: string[];
    ipv6: string[];
}

export interface XrUdpNoise {
    type: 'rand' | 'str' | 'base64' | 'hex' | 'array';
    packet: string;
    delay: string;
    count: number;
}

export interface WarpAccount {
    privateKey: string;
    publicKey: string;
    warpIPv6: string;
    reserved: string;
}

interface ClientCategory {
    core: 'xray' | 'xray-knocker' | 'sing-box' | 'clash' | 'wireguard' | 'amnezia';
    clients: string[];
}

export interface SubsCategory {
    label: 'Normal' | 'Fragment' | 'Raw' | 'Warp' | 'Warp Pro';
    categories: ClientCategory[];
}

export type Subscription = Record<string, SubsCategory>;

export interface Client {
    name: string;
    minVer: string;
    source: string;
    b64Url: string;
}
/* ==========================================================================
   ZAGROOO limits and usage accounting
   Stored apart from KvSettings so proxy settings stay shareable/exportable
   without leaking quotas, expiry dates or API keys.
   ========================================================================== */

export interface PanelApiKey {
    id: string;
    name: string;
    /** SHA-256 of the raw key. The raw key is shown once, at creation. */
    hash: string;
    createdAt: number;
    lastUsed: number;
}

export interface AlertState {
    quota80: boolean;
    quota100: boolean;
    expirySoon: boolean;
}

export interface PanelLimits {
    /** Label shown on the subscriber portal. */
    displayName: string;
    /** Public token that addresses the subscriber portal. */
    subToken: string;
    /**
     * Where this panel lives, recorded by the wizard at install time.
     * The dashboard builds its links from these instead of parsing the
     * deployed script, which is fragile and fails silently.
     */
    panelHost: string;
    panelPath: string;
    /**
     * Adds unroutable entries to the subscription whose names carry the
     * remaining quota and days. The customer sees them in their VPN app
     * without anyone having to message them.
     */
    showStatusNodes: boolean;
    /** Name of the ZagiRo profile last applied, for display only. */
    zagiroName: string;
    /**
     * API key the wizard uses to reach this panel's own endpoints, seeded at
     * install. Anyone holding the Cloudflare token can already rewrite the
     * whole worker, so keeping it in the same store adds no new exposure -
     * but it is stripped from every API response all the same.
     */
    wizardKey: string;
    /** 0 means unlimited, for every limit below. */
    limitTotalBytes: number;
    limitDailyBytes: number;
    downSpeedKbps: number;
    upSpeedKbps: number;
    /** Epoch ms. 0 means no expiry. */
    expireAt: number;
    /** Concurrent client IPs. 0 means unlimited. */
    maxDevices: number;
    isPaused: boolean;
    pauseReason: string;
    pausedAt: number;
    monthlyReset: boolean;
    /** Day of month, 1-28. */
    monthlyResetDay: number;
    alertQuota: boolean;
    alertExpiry: boolean;
    alertState: AlertState;
    panelApiKeys: PanelApiKey[];
}

export interface DayUsage {
    /** YYYY-MM-DD */
    d: string;
    /** bytes */
    b: number;
}

export interface UsageSnapshot {
    upBytes: number;
    downBytes: number;
    totalBytes: number;
    dailyBytes: number;
    /** YYYY-MM-DD the daily counter belongs to. */
    day: string;
    /** YYYY-MM of the last monthly reset. */
    lastMonthlyReset: string;
    /** Trailing 30 days, oldest first. */
    history: DayUsage[];
    updatedAt: number;
}

export type AccessDenialReason = 'paused' | 'expired' | 'quota' | 'daily-quota' | null;

export interface AccessVerdict {
    allowed: boolean;
    reason: AccessDenialReason;
    message: string;
}

export type PanelStatus = 'active' | 'paused' | 'expired' | 'limited' | 'daily-limited';
