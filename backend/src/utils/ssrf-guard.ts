/**
 * SSRF Guard — Prevents Server-Side Request Forgery attacks
 *
 * When a user submits a URL, the backend fetches it. Without protection,
 * an attacker could submit http://169.254.169.254/latest/meta-data/
 * (AWS metadata endpoint) to exfiltrate cloud credentials.
 *
 * We resolve DNS before fetching and block any IP that falls in:
 * - Private IPv4 ranges (RFC 1918)
 * - Link-local (169.254.x.x — AWS/GCP metadata)
 * - Loopback (127.x.x.x)
 * - IPv6 loopback/ULA
 */

export function isPrivateIP(ip: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(ip))
}

/** Parse IPv4 to 32-bit integer for range checking */
function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
}

/** More precise CIDR-based check for production use */
export function isPrivateCIDR(ip: string): boolean {
  // IPv6 loopback / ULA
  if (ip.includes(':')) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd')
  }

  const n = ipToInt(ip)

  const ranges = [
    [ipToInt('10.0.0.0'), ipToInt('10.255.255.255')],
    [ipToInt('172.16.0.0'), ipToInt('172.31.255.255')],
    [ipToInt('192.168.0.0'), ipToInt('192.168.255.255')],
    [ipToInt('127.0.0.0'), ipToInt('127.255.255.255')],
    [ipToInt('169.254.0.0'), ipToInt('169.254.255.255')],  // Link-local / cloud metadata
    [ipToInt('100.64.0.0'), ipToInt('100.127.255.255')],   // Carrier-grade NAT
    [ipToInt('0.0.0.0'), ipToInt('0.255.255.255')],
  ]

  return ranges.some(([start, end]) => n >= start && n <= end)
}
