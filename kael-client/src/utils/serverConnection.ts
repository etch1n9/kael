export const KAEL_SERVER_PORT = '1507';

export function normalizeServerOrigin(value: string): string {
  const input = value.trim();
  if (input === '/api' || input === '/api/') return defaultServerOrigin();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Isi alamat lengkap, misalnya http://192.168.1.20:1507 atau https://kael.instansi.id.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Alamat server harus memakai HTTP atau HTTPS tanpa kredensial, parameter, atau fragmen.');
  }
  if (!['/', '', '/api', '/api/'].includes(url.pathname)) {
    throw new Error('Gunakan alamat server tanpa jalur tambahan. Akhiran /api dikelola oleh KAEL.');
  }
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  return url.origin;
}

export function defaultServerOrigin(): string {
  const url = new URL(window.location.origin);
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  url.port = KAEL_SERVER_PORT;
  return url.origin;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || /^127\./.test(host);
}

function ipv4Parts(host: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPrivateIpv4(parts: number[]): boolean {
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
}

export interface ServerHealth {
  service: 'KAEL';
  protocol: 'kael-http';
  protocolVersion: 1;
  status: 'ok';
}

export interface ServerConnection {
  origin: string;
  latencyMs: number;
}

export async function probeServerHealth(origin: string, signal?: AbortSignal, timeoutMs = 8_000): Promise<ServerConnection> {
  const target = normalizeServerOrigin(origin);
  const url = new URL(target);
  const localAddress = isLoopback(url.hostname) || url.hostname.endsWith('.local') || isPrivateIpv4(ipv4Parts(url.hostname) || []);
  if (window.location.protocol === 'https:' && url.protocol === 'http:' && !localAddress) {
    throw new Error('Browser memblokir HTTP dari halaman HTTPS. Gunakan alamat server HTTPS atau buka client dari alamat yang sesuai.');
  }
  const start = performance.now();
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(`${target}/api/health`, {
      method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: requestSignal,
    });
    if (!response.ok) throw new Error('Server belum memberikan respons kesehatan KAEL.');
    const data = await response.json().catch(() => null) as Partial<ServerHealth> | null;
    if (!data || data.service !== 'KAEL' || data.protocol !== 'kael-http' || data.protocolVersion !== 1 || data.status !== 'ok') {
      throw new Error('Alamat ini belum terverifikasi sebagai server KAEL yang kompatibel.');
    }
    return { origin: target, latencyMs: Math.max(1, Math.round(performance.now() - start)) };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('Server belum merespons dalam batas waktu. Periksa alamat dan layanan server.');
    if (error instanceof TypeError) throw new Error('Koneksi belum dapat diverifikasi. Periksa alamat, jaringan, izin akses lokal browser, HTTPS, serta pengaturan origin client pada server.');
    throw error;
  }
}
